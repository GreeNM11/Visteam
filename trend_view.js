import { gsap } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm";

export function initTrendModule(shared) {
    const {
        dataStore,
        telemetryPromise,
        constants: { COLOR_PALETTE, TREND_FRAME_INTERVAL },
        utils: {
            clamp,
            escapeHtml,
            formatAxisNumber,
            formatMetricValue,
            getCompanyLabel,
            parseDateInput,
            clampToDataDomain,
            getIndexForDate,
            getRelativeCanvasPoint,
            shortDateFormatter,
            toDateKey,
            cloneCalendarDate
        }
    } = shared;

    const trendStartButton = document.getElementById("trendStart");
    const trendPauseButton = document.getElementById("trendPause");
    const trendCanvas = document.getElementById("trendChart");
    const trendControls = document.querySelector(".trend-controls");
    const trendTooltip = document.getElementById("trendTooltip");
    const trendStatusLabel = document.getElementById("trendStatus");

    if (!trendStartButton || !trendCanvas || !trendControls || !trendPauseButton || !trendTooltip || !trendStatusLabel) {
        return;
    }

    const ctx = trendCanvas.getContext("2d");
    const LINE_HIT_WIDTH = 10;
    let trendTween = null;
    let animationState = null;
    let lastRenderedCoords = null;
    let lastRenderedSeries = [];
    const hoverState = {
        activeKey: null,
        intensityByKey: {},
        tween: null,
        plotBounds: null
    };

    const showTrendStatus = (message, isError = false) => {
        trendStatusLabel.textContent = message;
        trendStatusLabel.classList.toggle("is-error", Boolean(isError));
    };

    const hideTooltip = () => {
        trendTooltip.hidden = true;
    };

    const colorToRgba = (hexColor, alpha) => {
        const color = String(hexColor || "").replace("#", "");
        const normalized = color.length === 3
            ? color.split("").map((character) => character + character).join("")
            : color;
        const red = Number.parseInt(normalized.slice(0, 2), 16) || 255;
        const green = Number.parseInt(normalized.slice(2, 4), 16) || 255;
        const blue = Number.parseInt(normalized.slice(4, 6), 16) || 255;
        return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
    };

    const redrawCurrentFrame = () => {
        if (!animationState) {
            return;
        }
        drawChart(animationState.timeline, animationState.datasets, animationState.visibleProgress);
    };

    const setHoveredSeries = (seriesKey) => {
        if (hoverState.activeKey === seriesKey) {
            return;
        }

        hoverState.activeKey = seriesKey;

        if (hoverState.tween) {
            hoverState.tween.kill();
            hoverState.tween = null;
        }

        const toValues = {};
        Object.keys(hoverState.intensityByKey).forEach((key) => {
            toValues[key] = seriesKey && key === seriesKey ? 1 : 0;
        });

        hoverState.tween = gsap.to(hoverState.intensityByKey, {
            ...toValues,
            duration: 0.1,
            ease: "power2.out",
            onUpdate: redrawCurrentFrame
        });
    };

    const getLineDistanceAtCursorX = (coords, mouseX, mouseY) => {
        if (!coords || coords.length < 2) {
            return Number.POSITIVE_INFINITY;
        }

        const first = coords[0];
        const last = coords[coords.length - 1];
        if (mouseX < first.x - 10 || mouseX > last.x + 10) {
            return Number.POSITIVE_INFINITY;
        }

        for (let index = 0; index < coords.length - 1; index += 1) {
            const start = coords[index];
            const end = coords[index + 1];
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);

            if (mouseX >= minX && mouseX <= maxX) {
                const segmentWidth = Math.max(end.x - start.x, 1e-6);
                const ratio = clamp((mouseX - start.x) / segmentWidth, 0, 1);
                const yAtCursor = start.y + (end.y - start.y) * ratio;
                return Math.abs(mouseY - yAtCursor);
            }
        }

        const edgeDistance = Math.min(
            Math.hypot(mouseX - first.x, mouseY - first.y),
            Math.hypot(mouseX - last.x, mouseY - last.y)
        );
        return edgeDistance;
    };

    const findLineHoverTarget = (mouseX, mouseY) => {
        if (!lastRenderedSeries.length) {
            return null;
        }

        let bestSeries = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        lastRenderedSeries.forEach((entry) => {
            if (!entry?.path || !entry?.coords?.length) {
                return;
            }

            ctx.save();
            ctx.lineWidth = entry.hitWidth;
            const isOnStroke = ctx.isPointInStroke(entry.path, mouseX, mouseY);
            ctx.restore();

            if (!isOnStroke) {
                return;
            }

            const distance = getLineDistanceAtCursorX(entry.coords, mouseX, mouseY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestSeries = entry.series;
            }
        });

        return bestSeries;
    };

    const findNearestPointInSeries = (series, mouseX, mouseY) => {
        if (!lastRenderedCoords || !series) {
            return null;
        }

        const coords = lastRenderedCoords.find((bucket) => bucket.length && bucket[0].series === series);
        if (!coords || !coords.length) {
            return null;
        }

        let nearest = null;

        for (let index = 0; index < coords.length; index += 1) {
            const point = coords[index];
            const dx = point.x - mouseX;
            const dy = point.y - mouseY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (!nearest || distance < nearest.distance) {
                nearest = { ...point, distance };
            }
        }

        if (!nearest) {
            return null;
        }

        return nearest;
    };

    const buildDatasetsFromTelemetry = (count, scope, startDate, endDate) => {
        if (!dataStore.ready || !dataStore.dateRange) {
            return null;
        }

        const range = clampToDataDomain(startDate, endDate);
        const startIndex = getIndexForDate(range.start);
        const endIndex = getIndexForDate(range.end);
        const timeline = dataStore.fullTimeline.slice(startIndex, endIndex + 1);

        if (!timeline.length) {
            return null;
        }

        const targetScope = scope === "all" ? null : scope;
        const selectedMetas = dataStore.rankedAppIds
            .map((appId) => dataStore.metadata.get(appId))
            .filter((meta) => meta && (!targetScope || meta.scope === targetScope))
            .filter((meta) => dataStore.pointsById.has(meta.appId))
            .slice(0, count);

        const datasets = selectedMetas
            .map((meta) => {
                const points = dataStore.pointsById.get(meta.appId).slice(startIndex, endIndex + 1);
                return {
                    name: meta.name,
                    company: getCompanyLabel(meta),
                    category: meta.studioSize || "Unspecified",
                    scope: meta.scope,
                    points,
                    coords: [],
                    meta
                };
            })
            .filter((series) => series.points.some((point) => point > 0));

        if (!datasets.length) {
            return null;
        }

        return { timeline, datasets };
    };

    const drawChart = (timeline, datasets, visibleProgress) => {
        ctx.clearRect(0, 0, trendCanvas.width, trendCanvas.height);
        const padding = 50;
        const width = trendCanvas.width - padding * 2;
        const height = trendCanvas.height - padding * 2;
        hoverState.plotBounds = {
            left: padding,
            right: padding + width,
            top: padding,
            bottom: padding + height
        };
        const clampedProgress = clamp(visibleProgress, 1, timeline.length);
        const fullPointCount = Math.max(1, Math.floor(clampedProgress));
        const nextPointRatio = clampedProgress - fullPointCount;
        const visiblePointCount = Math.min(Math.ceil(clampedProgress), timeline.length);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, padding + height);
        ctx.lineTo(padding + width, padding + height);
        ctx.stroke();

        const allPoints = datasets.flatMap((series) => series.points.slice(0, visiblePointCount));
        const maxValue = Math.max(...allPoints, 1);
        const minValue = Math.min(...allPoints, 0);
        const range = Math.max(maxValue - minValue, 1);
        const stepX = width / Math.max(timeline.length - 1, 1);

        ctx.save();
        ctx.fillStyle = "rgba(231, 236, 245, 0.8)";
        ctx.font = "600 11px 'Space Grotesk', sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const yTicks = 4;
        for (let index = 0; index <= yTicks; index += 1) {
            const ratio = index / yTicks;
            const y = padding + ratio * height;
            const value = maxValue - ratio * range;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.beginPath();
            ctx.moveTo(padding - 6, y);
            ctx.lineTo(padding, y);
            ctx.stroke();
            ctx.fillText(formatAxisNumber(value), padding - 10, y);
        }
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "rgba(231, 236, 245, 0.75)";
        ctx.font = "600 11px 'Space Grotesk', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const xTicks = Math.min(6, timeline.length);
        const stepCount = Math.max(Math.floor((timeline.length - 1) / Math.max(xTicks - 1, 1)), 1);
        for (let index = 0; index < timeline.length; index += stepCount) {
            const x = padding + stepX * index;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.beginPath();
            ctx.moveTo(x, padding + height);
            ctx.lineTo(x, padding + height + 6);
            ctx.stroke();
            ctx.fillText(shortDateFormatter.format(timeline[index]), x, padding + height + 8);
            if (index + stepCount >= timeline.length - 1) {
                break;
            }
        }
        ctx.restore();

        datasets.forEach((series) => {
            const key = series.meta?.appId || series.name;
            if (typeof hoverState.intensityByKey[key] !== "number") {
                hoverState.intensityByKey[key] = 0;
            }
        });
        const hasActiveHover = Object.values(hoverState.intensityByKey).some((value) => value > 0.02);
        const renderedSeries = [];

        datasets.forEach((series, seriesIndex) => {
            const coordBucket = [];
            const seriesKey = series.meta?.appId || series.name;
            const emphasis = hoverState.intensityByKey[seriesKey] || 0;
            const alpha = hasActiveHover ? 0.08 + emphasis * 0.92 : 1;
            const path = new Path2D();
            ctx.lineWidth = 1.8 + emphasis * 3.6;
            ctx.strokeStyle = colorToRgba(COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length], alpha);
            ctx.shadowBlur = emphasis > 0 ? 10 + emphasis * 10 : 0;
            ctx.shadowColor = colorToRgba(COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length], 0.8);

            series.points.slice(0, fullPointCount).forEach((value, pointIndex) => {
                const x = padding + stepX * pointIndex;
                const normalized = (value - minValue) / range;
                const y = padding + (1 - normalized) * height;

                coordBucket.push({
                    x,
                    y,
                    value,
                    date: timeline[pointIndex],
                    series
                });

                if (pointIndex === 0) {
                    path.moveTo(x, y);
                } else {
                    path.lineTo(x, y);
                }
            });

            if (nextPointRatio > 0 && fullPointCount < series.points.length) {
                const fromIndex = fullPointCount - 1;
                const toIndex = fullPointCount;
                const fromValue = series.points[fromIndex];
                const toValue = series.points[toIndex];
                const interpolatedValue = fromValue + (toValue - fromValue) * nextPointRatio;
                const x = padding + stepX * clampedProgress;
                const normalized = (interpolatedValue - minValue) / range;
                const y = padding + (1 - normalized) * height;

                coordBucket.push({
                    x,
                    y,
                    value: interpolatedValue,
                    date: timeline[toIndex],
                    series
                });
                path.lineTo(x, y);
            }

            ctx.stroke(path);
            ctx.shadowBlur = 0;
            series.coords = coordBucket;
            renderedSeries.push({
                series,
                coords: coordBucket,
                path,
                hitWidth: Math.max(ctx.lineWidth + LINE_HIT_WIDTH, 10)
            });
        });

        ctx.fillStyle = "rgba(231, 236, 245, 0.9)";
        ctx.font = "600 13px 'Space Grotesk', sans-serif";
        const labelIndex = Math.min(Math.floor(clampedProgress) - 1, timeline.length - 1);
        const progressLabel = timeline[labelIndex]
            ? toDateKey(timeline[labelIndex])
            : "";
        ctx.fillText(`Day ending ${progressLabel}`, padding, padding - 15);
        lastRenderedCoords = datasets.map((series) => series.coords || []);
        lastRenderedSeries = renderedSeries;
    };

    const setPauseButtonState = (mode) => {
        if (mode === "idle") {
            trendPauseButton.disabled = true;
            trendPauseButton.textContent = "Pause";
            trendPauseButton.dataset.mode = "idle";
            trendPauseButton.classList.remove("is-active");
            return;
        }

        trendPauseButton.disabled = false;
        trendPauseButton.classList.add("is-active");
        if (mode === "paused") {
            trendPauseButton.textContent = "Resume";
            trendPauseButton.dataset.mode = "paused";
        } else {
            trendPauseButton.textContent = "Pause";
            trendPauseButton.dataset.mode = "running";
        }
    };

    const stopAnimation = (resetState = false) => {
        if (trendTween) {
            trendTween.kill();
            trendTween = null;
        }
        if (hoverState.tween) {
            hoverState.tween.kill();
            hoverState.tween = null;
        }

        if (resetState) {
            animationState = null;
            lastRenderedCoords = null;
            lastRenderedSeries = [];
            hoverState.activeKey = null;
            hoverState.intensityByKey = {};
            setPauseButtonState("idle");
            hideTooltip();
        }
    };

    const startLoop = () => {
        if (!animationState) {
            return;
        }

        stopAnimation();
        drawChart(animationState.timeline, animationState.datasets, animationState.visibleProgress);
        trendTween = gsap.to(animationState, {
            visibleProgress: animationState.timeline.length,
            duration: Math.max(animationState.timeline.length * TREND_FRAME_INTERVAL, 800) / 1000,
            ease: "none",
            onUpdate: () => {
                if (!animationState) {
                    return;
                }
                drawChart(animationState.timeline, animationState.datasets, animationState.visibleProgress);
            },
            onComplete: () => {
                trendTween = null;
                if (animationState) {
                    animationState.visibleProgress = animationState.timeline.length;
                    drawChart(animationState.timeline, animationState.datasets, animationState.visibleProgress);
                }
                setPauseButtonState("idle");
            }
        });
        setPauseButtonState("running");
    };

    const pauseAnimation = () => {
        if (!trendTween) {
            return;
        }

        trendTween.pause();
        setPauseButtonState("paused");
    };

    const resumeAnimation = () => {
        if (!animationState || !trendTween) {
            return;
        }

        if (animationState.visibleProgress >= animationState.timeline.length) {
            setPauseButtonState("idle");
            return;
        }

        trendTween.play();
        setPauseButtonState("running");
    };

    setPauseButtonState("idle");
    showTrendStatus("Loading live telemetry...");

    trendStartButton.addEventListener("click", () => {
        stopAnimation(true);
        hideTooltip();

        if (!dataStore.ready) {
            showTrendStatus("Telemetry still syncing. Hold tight.", true);
            return;
        }

        const gameCountSelect = trendControls.querySelector("select[name='game-count']");
        const scopeSelect = trendControls.querySelector("select[name='publisher-scope']");
        const startInput = trendControls.querySelector("input[name='start-date']");
        const endInput = trendControls.querySelector("input[name='end-date']");

        const desiredCount = gameCountSelect?.value === "top15" ? 15 : 10;
        const fallbackStart = dataStore.dateRange?.start || cloneCalendarDate(new Date());
        const fallbackEnd = dataStore.dateRange?.end || cloneCalendarDate(new Date());
        const startDate = parseDateInput(startInput?.value || toDateKey(fallbackStart), fallbackStart);
        const endDate = parseDateInput(endInput?.value || toDateKey(fallbackEnd), fallbackEnd);
        const config = buildDatasetsFromTelemetry(
            desiredCount,
            scopeSelect?.value || "all",
            startDate,
            endDate
        );

        if (!config) {
            showTrendStatus("No telemetry for that filter window.", true);
            setPauseButtonState("idle");
            return;
        }

        animationState = {
            timeline: config.timeline,
            datasets: config.datasets,
            visibleProgress: 1
        };

        showTrendStatus(
            `Animating ${config.datasets.length} titles from ${toDateKey(config.timeline[0])} to ${toDateKey(
                config.timeline[config.timeline.length - 1]
            )}.`
        );

        startLoop();
    });

    trendPauseButton.addEventListener("click", () => {
        if (!animationState) {
            return;
        }

        if (trendPauseButton.dataset.mode === "running") {
            pauseAnimation();
        } else {
            resumeAnimation();
        }
    });

    trendCanvas.addEventListener("dblclick", () => {
        stopAnimation(true);
        hideTooltip();
    });

    trendCanvas.addEventListener("mouseleave", () => {
        hideTooltip();
        setHoveredSeries(null);
    });

    trendCanvas.addEventListener("mousemove", (event) => {
        if (!animationState || !lastRenderedCoords) {
            hideTooltip();
            return;
        }

        const { x: mouseX, y: mouseY } = getRelativeCanvasPoint(trendCanvas, event.clientX, event.clientY);
        const plot = hoverState.plotBounds;
        if (plot && (mouseX < plot.left || mouseX > plot.right || mouseY < plot.top || mouseY > plot.bottom)) {
            setHoveredSeries(null);
            hideTooltip();
            return;
        }

        const hoveredSeries = findLineHoverTarget(mouseX, mouseY);
        setHoveredSeries(hoveredSeries?.meta?.appId || hoveredSeries?.name || null);

        if (!hoveredSeries) {
            hideTooltip();
            return;
        }

        const nearest = findNearestPointInSeries(hoveredSeries, mouseX, mouseY);

        if (!nearest) {
            hideTooltip();
            return;
        }

        trendTooltip.innerHTML = `
            <strong>${escapeHtml(nearest.series.name)}</strong>
            <span>${escapeHtml(formatMetricValue(nearest.value, "raw"))}</span>
            <span>${escapeHtml(nearest.series.company)}</span>
            <span>${escapeHtml(nearest.series.category)}</span>
            <span>${escapeHtml(toDateKey(nearest.date))}</span>
        `;
        trendTooltip.style.left = `${mouseX + 15}px`;
        trendTooltip.style.top = `${mouseY - 10}px`;
        trendTooltip.hidden = false;
    });

    telemetryPromise
        .then(() => {
            if (!dataStore.ready) {
                showTrendStatus("CSV files loaded but no overlapping telemetry found.", true);
                return;
            }

            const startInput = trendControls.querySelector("input[name='start-date']");
            const endInput = trendControls.querySelector("input[name='end-date']");
            if (startInput) {
                startInput.value = toDateKey(dataStore.dateRange.start);
            }
            if (endInput) {
                endInput.value = toDateKey(dataStore.dateRange.end);
            }

            trendStartButton.disabled = false;
            const dayRange = dataStore.fullTimeline.length;
            showTrendStatus(`Telemetry synced for ${dataStore.rankedAppIds.length} titles across ${dayRange} days.`);
        })
        .catch((error) => {
            console.error(error);
            trendStartButton.disabled = true;
            showTrendStatus("Failed to load CSV telemetry. Check console.", true);
        });
}
