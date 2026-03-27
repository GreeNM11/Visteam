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
    let animationTimer = null;
    let animationState = null;
    let lastRenderedCoords = null;

    const showTrendStatus = (message, isError = false) => {
        trendStatusLabel.textContent = message;
        trendStatusLabel.classList.toggle("is-error", Boolean(isError));
    };

    const hideTooltip = () => {
        trendTooltip.hidden = true;
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

    const drawChart = (timeline, datasets, visiblePoints) => {
        ctx.clearRect(0, 0, trendCanvas.width, trendCanvas.height);
        const padding = 50;
        const width = trendCanvas.width - padding * 2;
        const height = trendCanvas.height - padding * 2;

        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, padding + height);
        ctx.lineTo(padding + width, padding + height);
        ctx.stroke();

        const allPoints = datasets.flatMap((series) => series.points.slice(0, visiblePoints));
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

        datasets.forEach((series, seriesIndex) => {
            const coordBucket = [];
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.strokeStyle = COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length];

            series.points.slice(0, visiblePoints).forEach((value, pointIndex) => {
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
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.stroke();
            series.coords = coordBucket;
        });

        ctx.fillStyle = "rgba(231, 236, 245, 0.9)";
        ctx.font = "600 13px 'Space Grotesk', sans-serif";
        const progressLabel = timeline[Math.min(visiblePoints - 1, timeline.length - 1)]
            ? toDateKey(timeline[Math.min(visiblePoints - 1, timeline.length - 1)])
            : "";
        ctx.fillText(`Day ending ${progressLabel}`, padding, padding - 15);
        lastRenderedCoords = datasets.map((series) => series.coords || []);
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
        if (animationTimer) {
            clearInterval(animationTimer);
            animationTimer = null;
        }

        if (resetState) {
            animationState = null;
            lastRenderedCoords = null;
            setPauseButtonState("idle");
            hideTooltip();
        }
    };

    const advanceFrame = () => {
        if (!animationState) {
            stopAnimation(true);
            return;
        }

        animationState.visiblePoints += 1;
        if (animationState.visiblePoints > animationState.timeline.length) {
            stopAnimation(true);
            return;
        }

        drawChart(animationState.timeline, animationState.datasets, animationState.visiblePoints);
    };

    const startLoop = () => {
        if (!animationState) {
            return;
        }

        stopAnimation();
        drawChart(animationState.timeline, animationState.datasets, animationState.visiblePoints);
        animationTimer = setInterval(advanceFrame, TREND_FRAME_INTERVAL);
        setPauseButtonState("running");
    };

    const pauseAnimation = () => {
        if (!animationTimer) {
            return;
        }

        clearInterval(animationTimer);
        animationTimer = null;
        setPauseButtonState("paused");
    };

    const resumeAnimation = () => {
        if (!animationState || animationTimer) {
            return;
        }

        if (animationState.visiblePoints >= animationState.timeline.length) {
            setPauseButtonState("idle");
            return;
        }

        animationTimer = setInterval(advanceFrame, TREND_FRAME_INTERVAL);
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
            visiblePoints: 1
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

    trendCanvas.addEventListener("mouseleave", hideTooltip);

    trendCanvas.addEventListener("mousemove", (event) => {
        if (!animationState || !lastRenderedCoords) {
            hideTooltip();
            return;
        }

        const { x: mouseX, y: mouseY } = getRelativeCanvasPoint(trendCanvas, event.clientX, event.clientY);
        let nearest = null;
        const threshold = 12;

        lastRenderedCoords.forEach((coords) => {
            coords.forEach((point) => {
                const dx = point.x - mouseX;
                const dy = point.y - mouseY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= threshold && (!nearest || distance < nearest.distance)) {
                    nearest = { ...point, distance };
                }
            });
        });

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
