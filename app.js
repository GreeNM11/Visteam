document.addEventListener("DOMContentLoaded", () => {
    const navLinks = document.querySelectorAll(".rail nav a[data-view]");
    const blankState = document.querySelector(".canvas__blank");
    const canvasPanels = document.querySelectorAll(".canvas__content[data-view]");

    if (!navLinks.length || !blankState || !canvasPanels.length) {
        return;
    }

    navLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();

            navLinks.forEach((item) => item.classList.remove("is-active"));
            link.classList.add("is-active");

            const targetView = link.dataset.view;
            let matchedPanel = null;

            canvasPanels.forEach((panel) => {
                if (panel.dataset.view === targetView) {
                    panel.hidden = false;
                    matchedPanel = panel;
                } else {
                    panel.hidden = true;
                }
            });

            blankState.hidden = Boolean(matchedPanel);
        });
    });

    const COLOR_PALETTE = [
        "#64e9ff",
        "#8f7bff",
        "#ff8bd2",
        "#f7c948",
        "#7ed957",
        "#ff6f61",
        "#46c2ff",
        "#e56b6f",
        "#c492ff",
        "#73fbd3",
        "#ffbf69",
        "#72a1ff",
        "#ff9d76",
        "#7bd389",
        "#f67280"
    ];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const TREND_FRAME_INTERVAL = 300;
    const COMPARE_MIN_SELECTION = 2;
    const COMPARE_MAX_SELECTION = 6;
    const MIN_WINDOW_POINTS = 3;

    const compactNumberFormatter = new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1
    });
    const integerFormatter = new Intl.NumberFormat("en");
    const decimalFormatter = new Intl.NumberFormat("en", {
        maximumFractionDigits: 1
    });
    const percentFormatter = new Intl.NumberFormat("en", {
        style: "percent",
        signDisplay: "always",
        maximumFractionDigits: 1
    });
    const shortDateFormatter = new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric"
    });
    const longDateFormatter = new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });

    const dataStore = {
        metadata: new Map(),
        rankedAppIds: [],
        seriesById: new Map(),
        dateRange: null,
        fullTimeline: [],
        dateKeys: [],
        indexByDateKey: new Map(),
        pointsById: new Map(),
        ready: false
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const escapeHtml = (value = "") =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    const padNumber = (value) => String(value).padStart(2, "0");

    const createCalendarDate = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
        if (!match) {
            return null;
        }
        const [, year, month, day] = match;
        return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
    };

    const cloneCalendarDate = (date) =>
        new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);

    const addDays = (date, amount) => {
        const next = cloneCalendarDate(date);
        next.setDate(next.getDate() + amount);
        return next;
    };

    const getUtcDayValue = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

    const daysBetween = (startDate, endDate) =>
        Math.round((getUtcDayValue(endDate) - getUtcDayValue(startDate)) / DAY_MS);

    const toDateKey = (date) =>
        `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;

    const formatAxisNumber = (value) => {
        const absolute = Math.abs(value);
        if (absolute >= 1000) {
            return compactNumberFormatter.format(value);
        }
        return decimalFormatter.format(value);
    };

    const formatMetricValue = (value, mode, includeUnits = true) => {
        if (mode === "indexed") {
            const formatted = decimalFormatter.format(value);
            return includeUnits ? `${formatted} index` : formatted;
        }
        const absolute = Math.abs(value);
        const formatted =
            absolute >= 1000 ? compactNumberFormatter.format(value) : integerFormatter.format(Math.round(value));
        return includeUnits ? `${formatted} players` : formatted;
    };

    const formatRawChange = (value) => {
        const prefix = value >= 0 ? "+" : "-";
        const absolute = Math.abs(value);
        const formatted =
            absolute >= 1000 ? compactNumberFormatter.format(absolute) : integerFormatter.format(Math.round(absolute));
        return `${prefix}${formatted} players`;
    };

    const formatIndexedChange = (value) => {
        const prefix = value >= 0 ? "+" : "";
        return `${prefix}${decimalFormatter.format(value)} pts`;
    };

    const formatPercentChange = (startValue, endValue) => {
        if (startValue <= 0) {
            return "No baseline";
        }
        return percentFormatter.format((endValue - startValue) / startValue);
    };

    const getCompanyLabel = (meta) => meta.publisher || meta.developer || "Independent Studio";

    const parseCSVRows = (text) => {
        const rows = [];
        let current = "";
        let row = [];
        let inQuotes = false;

        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (character === "\"") {
                if (inQuotes && text[index + 1] === "\"") {
                    current += "\"";
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (character === "," && !inQuotes) {
                row.push(current);
                current = "";
            } else if ((character === "\n" || character === "\r") && !inQuotes) {
                if (character === "\r" && text[index + 1] === "\n") {
                    index += 1;
                }
                row.push(current);
                rows.push(row);
                row = [];
                current = "";
            } else {
                current += character;
            }
        }

        if (current.length > 0 || row.length) {
            row.push(current);
            rows.push(row);
        }

        return rows.filter((entry) => entry.length && !(entry.length === 1 && entry[0] === ""));
    };

    const normalizeScope = (studioSize = "") => {
        const normalized = studioSize.toLowerCase();
        if (normalized.includes("large")) {
            return "large";
        }
        if (normalized.includes("medium")) {
            return "medium";
        }
        if (normalized.includes("indie")) {
            return "indie";
        }
        return "all";
    };

    const hydrateMetadata = (text) => {
        const rows = parseCSVRows(text);
        if (!rows.length) {
            return { metaMap: new Map(), rankedAppIds: [] };
        }

        const headers = rows[0];
        const metaMap = new Map();
        const ordered = [];

        rows.slice(1).forEach((cells) => {
            const record = {};
            headers.forEach((header, index) => {
                record[header] = cells[index] ?? "";
            });

            const appId = String(record.AppID || "").trim();
            if (!appId) {
                return;
            }

            const studioSize = String(record["Studio Size"] || "").trim();
            const peakCCU = Number(String(record["Peak CCU"] || "0").replace(/,/g, "")) || 0;
            const entry = {
                appId,
                name: String(record.Name || appId).trim(),
                developer: String(record.Developers || "").trim(),
                publisher: String(record.Publishers || "").trim(),
                categories: String(record.Categories || "").trim(),
                genres: String(record.Genres || "").trim(),
                tags: String(record.Tags || "").trim(),
                studioSize,
                scope: normalizeScope(studioSize),
                peakCCU
            };

            metaMap.set(appId, entry);
            ordered.push(entry);
        });

        ordered.sort((left, right) => right.peakCCU - left.peakCCU);

        return { metaMap, rankedAppIds: ordered.map((entry) => entry.appId) };
    };

    const hydrateDailySeries = (text) => {
        const rows = parseCSVRows(text);
        if (!rows.length) {
            return { seriesById: new Map(), dateRange: null };
        }

        const headers = rows[0];
        const appIds = headers.slice(1);
        const seriesById = new Map();
        let minDate = null;
        let maxDate = null;

        rows.slice(1).forEach((cells) => {
            const rawDate = String(cells[0] || "").trim();
            if (!rawDate) {
                return;
            }

            const parsedDate = createCalendarDate(rawDate);
            if (!parsedDate) {
                return;
            }

            const dateKey = toDateKey(parsedDate);
            if (!minDate || getUtcDayValue(parsedDate) < getUtcDayValue(minDate)) {
                minDate = parsedDate;
            }
            if (!maxDate || getUtcDayValue(parsedDate) > getUtcDayValue(maxDate)) {
                maxDate = parsedDate;
            }

            appIds.forEach((appId, index) => {
                if (!appId) {
                    return;
                }

                const value = Number(cells[index + 1] || 0);
                if (!seriesById.has(appId)) {
                    seriesById.set(appId, new Map());
                }
                if (!Number.isNaN(value)) {
                    seriesById.get(appId).set(dateKey, value);
                }
            });
        });

        const dateRange = minDate && maxDate ? { start: minDate, end: maxDate } : null;
        return { seriesById, dateRange };
    };

    const buildTimeline = (startDate, endDate) => {
        const timeline = [];
        let cursor = cloneCalendarDate(startDate);
        const lastDay = getUtcDayValue(endDate);

        while (getUtcDayValue(cursor) <= lastDay) {
            timeline.push(cloneCalendarDate(cursor));
            cursor = addDays(cursor, 1);
        }

        if (timeline.length < 2) {
            timeline.push(cloneCalendarDate(endDate));
        }

        return timeline;
    };

    const parseDateInput = (value, fallback) => createCalendarDate(value) || cloneCalendarDate(fallback);

    const clampToDataDomain = (startDate, endDate) => {
        if (!dataStore.dateRange) {
            return {
                start: cloneCalendarDate(startDate),
                end: cloneCalendarDate(endDate)
            };
        }

        let start = cloneCalendarDate(startDate);
        let end = cloneCalendarDate(endDate);

        if (getUtcDayValue(start) > getUtcDayValue(end)) {
            const temporaryDate = start;
            start = end;
            end = temporaryDate;
        }

        if (getUtcDayValue(start) < getUtcDayValue(dataStore.dateRange.start)) {
            start = cloneCalendarDate(dataStore.dateRange.start);
        }

        if (getUtcDayValue(end) > getUtcDayValue(dataStore.dateRange.end)) {
            end = cloneCalendarDate(dataStore.dateRange.end);
        }

        return { start, end };
    };

    const getIndexForDate = (date) => clamp(daysBetween(dataStore.dateRange.start, date), 0, dataStore.fullTimeline.length - 1);

    const getRelativeCanvasPoint = (canvas, clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
            rect
        };
    };

    const isPointInPlot = (point, plot) =>
        point.x >= plot.left && point.x <= plot.right && point.y >= plot.top && point.y <= plot.bottom;

    const pixelToIndex = (x, plot, stepX, itemCount) =>
        clamp(Math.round((x - plot.left) / Math.max(stepX, 1)), 0, Math.max(itemCount - 1, 0));

    const drawCanvasPlaceholder = (ctx, canvas, title, detail) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(6, 10, 16, 0.82)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(231, 236, 245, 0.92)";
        ctx.font = "600 18px 'Space Grotesk', sans-serif";
        ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 18);

        ctx.fillStyle = "rgba(138, 145, 167, 0.95)";
        ctx.font = "500 12px 'Space Grotesk', sans-serif";
        ctx.fillText(detail, canvas.width / 2, canvas.height / 2 + 12);
    };

    const loadTelemetry = async () => {
        const [topResponse, dailyResponse] = await Promise.all([
            fetch("data/top500.csv"),
            fetch("data/daily_peaks_top500.csv")
        ]);

        if (!topResponse.ok || !dailyResponse.ok) {
            throw new Error("Failed to fetch telemetry CSV files.");
        }

        const [topText, dailyText] = await Promise.all([topResponse.text(), dailyResponse.text()]);
        const metadataResult = hydrateMetadata(topText);
        const dailyResult = hydrateDailySeries(dailyText);

        dataStore.metadata = metadataResult.metaMap;
        dataStore.seriesById = dailyResult.seriesById;
        dataStore.dateRange = dailyResult.dateRange;
        dataStore.rankedAppIds = metadataResult.rankedAppIds.filter((appId) => dataStore.seriesById.has(appId));
        dataStore.fullTimeline = dataStore.dateRange
            ? buildTimeline(dataStore.dateRange.start, dataStore.dateRange.end)
            : [];
        dataStore.dateKeys = dataStore.fullTimeline.map((date) => toDateKey(date));
        dataStore.indexByDateKey = new Map(dataStore.dateKeys.map((dateKey, index) => [dateKey, index]));
        dataStore.pointsById = new Map();

        dataStore.rankedAppIds.forEach((appId) => {
            const dayMap = dataStore.seriesById.get(appId);
            const points = dataStore.dateKeys.map((dateKey) => {
                const value = dayMap?.get(dateKey);
                return typeof value === "number" ? value : 0;
            });
            dataStore.pointsById.set(appId, points);
        });

        dataStore.ready = Boolean(dataStore.dateRange) && dataStore.rankedAppIds.length > 0;
        return dataStore;
    };

    const telemetryPromise = loadTelemetry();

    const initTrendModule = () => {
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
    };

    const initCompareModule = () => {
        const compareCanvas = document.getElementById("compareChart");
        const compareOverviewCanvas = document.getElementById("compareOverviewChart");
        const compareTooltip = document.getElementById("compareTooltip");
        const compareStatusLabel = document.getElementById("compareStatus");
        const compareSearchInput = document.getElementById("compareSearch");
        const compareSuggestions = document.getElementById("compareSuggestions");
        const compareSelected = document.getElementById("compareSelected");
        const compareLegend = document.getElementById("compareLegend");
        const compareSummary = document.getElementById("compareSummary");
        const compareMarkerForm = document.getElementById("compareMarkerForm");
        const compareMarkerDateInput = document.getElementById("compareMarkerDate");
        const compareMarkerLabelInput = document.getElementById("compareMarkerLabel");
        const compareMarkerList = document.getElementById("compareMarkerList");
        const compareResetButton = document.getElementById("compareReset");
        const compareModeToggle = document.getElementById("compareModeToggle");

        if (
            !compareCanvas ||
            !compareOverviewCanvas ||
            !compareTooltip ||
            !compareStatusLabel ||
            !compareSearchInput ||
            !compareSuggestions ||
            !compareSelected ||
            !compareLegend ||
            !compareSummary ||
            !compareMarkerForm ||
            !compareMarkerDateInput ||
            !compareMarkerLabelInput ||
            !compareMarkerList ||
            !compareResetButton ||
            !compareModeToggle
        ) {
            return;
        }

        const mainCtx = compareCanvas.getContext("2d");
        const overviewCtx = compareOverviewCanvas.getContext("2d");
        const compareSearchShell = compareSearchInput.closest(".compare-search");

        const state = {
            selectedAppIds: [],
            metricMode: "raw",
            visibleWindow: null,
            manualMarkers: [],
            searchOpen: false,
            hoverPoint: null,
            zoomDrag: null,
            brushDrag: null,
            currentConfig: null,
            mainRenderMeta: null,
            overviewRenderMeta: null
        };

        const setCompareStatus = (message, isError = false) => {
            compareStatusLabel.textContent = message;
            compareStatusLabel.classList.toggle("is-error", Boolean(isError));
        };

        const hideCompareTooltip = () => {
            compareTooltip.hidden = true;
        };

        const getColorForIndex = (index) => COLOR_PALETTE[index % COLOR_PALETTE.length];

        const ensureVisibleWindow = () => {
            if (!dataStore.ready) {
                return;
            }

            const fullLength = dataStore.fullTimeline.length;
            if (!state.visibleWindow) {
                state.visibleWindow = {
                    start: 0,
                    end: fullLength - 1
                };
                return;
            }

            const maxIndex = fullLength - 1;
            let start = clamp(state.visibleWindow.start, 0, maxIndex);
            let end = clamp(state.visibleWindow.end, 0, maxIndex);

            if (end < start) {
                [start, end] = [end, start];
            }

            if (end - start + 1 < MIN_WINDOW_POINTS) {
                end = clamp(start + MIN_WINDOW_POINTS - 1, 0, maxIndex);
                start = clamp(end - MIN_WINDOW_POINTS + 1, 0, maxIndex);
            }

            state.visibleWindow = { start, end };
        };

        const isFullWindow = () =>
            Boolean(
                state.visibleWindow &&
                    state.visibleWindow.start === 0 &&
                    state.visibleWindow.end === dataStore.fullTimeline.length - 1
            );

        const getSelectedSeries = () =>
            state.selectedAppIds
                .map((appId, index) => {
                    const meta = dataStore.metadata.get(appId);
                    const fullPoints = dataStore.pointsById.get(appId);
                    if (!meta || !fullPoints) {
                        return null;
                    }

                    return {
                        appId,
                        meta,
                        color: getColorForIndex(index),
                        fullPoints
                    };
                })
                .filter(Boolean);

        const toIndexedSeries = (points) => {
            if (!points.length) {
                return [];
            }

            const exactBaseline = points[0];
            const fallbackBaseline = points.find((value) => value > 0) || 0;
            const baseline = exactBaseline > 0 ? exactBaseline : fallbackBaseline;

            if (!baseline) {
                return points.map(() => 0);
            }

            return points.map((value) => (value / baseline) * 100);
        };

        const buildCompareConfig = () => {
            if (!dataStore.ready) {
                return null;
            }

            ensureVisibleWindow();

            const selectedSeries = getSelectedSeries();
            if (selectedSeries.length < COMPARE_MIN_SELECTION) {
                return null;
            }

            const visibleTimeline = dataStore.fullTimeline.slice(state.visibleWindow.start, state.visibleWindow.end + 1);
            const datasets = selectedSeries.map((series) => {
                const rawPoints = series.fullPoints.slice(state.visibleWindow.start, state.visibleWindow.end + 1);
                const displayPoints = state.metricMode === "indexed" ? toIndexedSeries(rawPoints) : rawPoints.slice();
                const latestValue = displayPoints[displayPoints.length - 1] || 0;
                const peakValue = Math.max(...displayPoints, 0);
                const changeValue = latestValue - (displayPoints[0] || 0);
                const rawLatest = rawPoints[rawPoints.length - 1] || 0;

                return {
                    ...series,
                    rawPoints,
                    points: displayPoints,
                    latestValue,
                    peakValue,
                    changeValue,
                    percentChange: formatPercentChange(rawPoints[0] || 0, rawLatest),
                    rawLatest,
                    coords: []
                };
            });

            const visibleMarkers = state.manualMarkers
                .map((marker) => {
                    const globalIndex = dataStore.indexByDateKey.get(marker.dateKey);
                    return typeof globalIndex === "number" ? { ...marker, globalIndex } : null;
                })
                .filter(Boolean)
                .filter(
                    (marker) =>
                        marker.globalIndex >= state.visibleWindow.start && marker.globalIndex <= state.visibleWindow.end
                );

            return {
                timeline: visibleTimeline,
                datasets,
                selectedSeries,
                markers: visibleMarkers,
                window: { ...state.visibleWindow },
                fullTimeline: dataStore.fullTimeline
            };
        };

        const renderModeButtons = () => {
            compareModeToggle.querySelectorAll("button[data-mode]").forEach((button) => {
                const isActive = button.dataset.mode === state.metricMode;
                button.classList.toggle("is-active", isActive);
                button.setAttribute("aria-pressed", String(isActive));
            });
        };

        const renderSelectedChips = () => {
            if (!state.selectedAppIds.length) {
                compareSelected.innerHTML = `
                    <p class="compare-empty-note">No games selected yet. Pick any 2 to start the overlay.</p>
                `;
                return;
            }

            compareSelected.innerHTML = state.selectedAppIds
                .map((appId, index) => {
                    const meta = dataStore.metadata.get(appId);
                    if (!meta) {
                        return "";
                    }

                    return `
                        <button
                            class="compare-chip"
                            type="button"
                            data-remove-appid="${escapeHtml(appId)}"
                            aria-label="Remove ${escapeHtml(meta.name)} from comparison"
                        >
                            <span class="compare-chip__swatch" style="--swatch:${escapeHtml(getColorForIndex(index))}"></span>
                            <span>${escapeHtml(meta.name)}</span>
                            <span class="compare-chip__remove" aria-hidden="true">&times;</span>
                        </button>
                    `;
                })
                .join("");
        };

        const getFilteredOptions = () => {
            const query = compareSearchInput.value.trim().toLowerCase();
            const selectedSet = new Set(state.selectedAppIds);
            const candidates = dataStore.rankedAppIds
                .map((appId) => dataStore.metadata.get(appId))
                .filter((meta) => meta && !selectedSet.has(meta.appId));

            if (!query) {
                return candidates.slice(0, 8);
            }

            return candidates
                .map((meta) => {
                    const name = meta.name.toLowerCase();
                    const publisher = meta.publisher.toLowerCase();
                    const developer = meta.developer.toLowerCase();
                    const haystack = `${name} ${publisher} ${developer}`;
                    let score = Number.POSITIVE_INFINITY;

                    if (name.startsWith(query)) {
                        score = 0;
                    } else if (name.includes(query)) {
                        score = 1;
                    } else if (publisher.includes(query) || developer.includes(query)) {
                        score = 2;
                    } else if (haystack.includes(query)) {
                        score = 3;
                    }

                    return { meta, score };
                })
                .filter((entry) => Number.isFinite(entry.score))
                .sort((left, right) => left.score - right.score || right.meta.peakCCU - left.meta.peakCCU)
                .slice(0, 8)
                .map((entry) => entry.meta);
        };

        const renderSearchResults = () => {
            if (!dataStore.ready || !state.searchOpen) {
                compareSuggestions.hidden = true;
                compareSuggestions.innerHTML = "";
                return;
            }

            if (state.selectedAppIds.length >= COMPARE_MAX_SELECTION) {
                compareSuggestions.hidden = false;
                compareSuggestions.innerHTML = `
                    <div class="compare-search__empty">Selection limit reached. Remove a game to add another.</div>
                `;
                return;
            }

            const results = getFilteredOptions();
            if (!results.length) {
                compareSuggestions.hidden = false;
                compareSuggestions.innerHTML = `
                    <div class="compare-search__empty">No matching games found in the tracked top titles.</div>
                `;
                return;
            }

            compareSuggestions.hidden = false;
            compareSuggestions.innerHTML = results
                .map(
                    (meta) => `
                        <button class="compare-search__result" type="button" data-appid="${escapeHtml(meta.appId)}">
                            <strong>${escapeHtml(meta.name)}</strong>
                            <span>${escapeHtml(getCompanyLabel(meta))}</span>
                            <small>Peak ${escapeHtml(formatMetricValue(meta.peakCCU, "raw"))}</small>
                        </button>
                    `
                )
                .join("");
        };

        const renderLegend = (selectedSeries) => {
            if (!selectedSeries.length) {
                compareLegend.innerHTML = "";
                return;
            }

            compareLegend.innerHTML = selectedSeries
                .map(
                    (series) => `
                        <span class="compare-legend__item">
                            <span class="compare-legend__swatch" style="--swatch:${escapeHtml(series.color)}"></span>
                            <span>${escapeHtml(series.meta.name)}</span>
                        </span>
                    `
                )
                .join("");
        };

        const renderSummary = (config) => {
            if (!config) {
                compareSummary.innerHTML = `
                    <p class="compare-empty-note">Summary cards will appear once at least two games are selected.</p>
                `;
                return;
            }

            const windowStart = longDateFormatter.format(config.timeline[0]);
            const windowEnd = longDateFormatter.format(config.timeline[config.timeline.length - 1]);
            compareSummary.innerHTML = config.datasets
                .map((series) => {
                    const changeValue =
                        state.metricMode === "indexed"
                            ? formatIndexedChange(series.changeValue)
                            : formatRawChange(series.changeValue);

                    const secondaryMetric =
                        state.metricMode === "indexed"
                            ? `Raw latest ${formatMetricValue(series.rawLatest, "raw")}`
                            : `${series.percentChange} vs window start`;

                    return `
                        <article class="compare-summary-card">
                            <div class="compare-summary-card__head">
                                <span class="compare-summary-card__swatch" style="--swatch:${escapeHtml(series.color)}"></span>
                                <div>
                                    <strong>${escapeHtml(series.meta.name)}</strong>
                                    <p>${escapeHtml(getCompanyLabel(series.meta))}</p>
                                </div>
                            </div>
                            <dl class="compare-summary-card__stats">
                                <div>
                                    <dt>Latest</dt>
                                    <dd>${escapeHtml(formatMetricValue(series.latestValue, state.metricMode))}</dd>
                                </div>
                                <div>
                                    <dt>Peak</dt>
                                    <dd>${escapeHtml(formatMetricValue(series.peakValue, state.metricMode))}</dd>
                                </div>
                                <div>
                                    <dt>Change</dt>
                                    <dd>${escapeHtml(changeValue)}</dd>
                                </div>
                            </dl>
                            <p class="compare-summary-card__foot">${escapeHtml(secondaryMetric)}</p>
                            <p class="compare-summary-card__range">${escapeHtml(windowStart)} to ${escapeHtml(windowEnd)}</p>
                        </article>
                    `;
                })
                .join("");
        };

        const renderMarkerList = () => {
            if (!state.manualMarkers.length) {
                compareMarkerList.innerHTML = `
                    <p class="compare-empty-note">Add dated markers for patches, launches, or crossover events.</p>
                `;
                return;
            }

            compareMarkerList.innerHTML = state.manualMarkers
                .map(
                    (marker) => `
                        <article class="compare-marker-item">
                            <div>
                                <strong>${escapeHtml(marker.label)}</strong>
                                <p>${escapeHtml(longDateFormatter.format(createCalendarDate(marker.dateKey)))}</p>
                            </div>
                            <button class="compare-marker-item__remove" type="button" data-remove-marker="${escapeHtml(
                                marker.id
                            )}">
                                Remove
                            </button>
                        </article>
                    `
                )
                .join("");
        };

        const syncCompareControls = () => {
            renderModeButtons();
            compareResetButton.disabled =
                !dataStore.ready || state.selectedAppIds.length < COMPARE_MIN_SELECTION || isFullWindow();
        };

        const drawCompareChart = (config) => {
            if (!config) {
                drawCanvasPlaceholder(
                    mainCtx,
                    compareCanvas,
                    "Select at least 2 games",
                    "Overlay timelines here to zoom into player counter movement."
                );
                state.mainRenderMeta = null;
                return;
            }

            mainCtx.clearRect(0, 0, compareCanvas.width, compareCanvas.height);
            const padding = {
                top: 104,
                right: 28,
                bottom: 52,
                left: 72
            };
            const plot = {
                left: padding.left,
                top: padding.top,
                right: compareCanvas.width - padding.right,
                bottom: compareCanvas.height - padding.bottom
            };
            plot.width = plot.right - plot.left;
            plot.height = plot.bottom - plot.top;

            const allPoints = config.datasets.flatMap((series) => series.points);
            let minValue = Math.min(...allPoints);
            let maxValue = Math.max(...allPoints);

            if (minValue === maxValue) {
                minValue -= 1;
                maxValue += 1;
            } else {
                const paddingValue = Math.max((maxValue - minValue) * 0.08, 1);
                minValue -= paddingValue;
                maxValue += paddingValue;
            }

            const range = Math.max(maxValue - minValue, 1);
            const stepX = plot.width / Math.max(config.timeline.length - 1, 1);
            const chartTitleY = 22;
            const chartSubtitleY = 38;
            const markerBandTop = 54;
            const markerLabelHeight = 18;
            const markerRowGap = 8;

            mainCtx.fillStyle = "rgba(6, 10, 16, 0.72)";
            mainCtx.fillRect(0, 0, compareCanvas.width, compareCanvas.height);

            if (config.markers.length) {
                mainCtx.fillStyle = "rgba(247, 201, 72, 0.05)";
                mainCtx.fillRect(
                    plot.left,
                    markerBandTop - 8,
                    plot.width,
                    plot.top - markerBandTop + 10
                );
                mainCtx.strokeStyle = "rgba(247, 201, 72, 0.14)";
                mainCtx.strokeRect(
                    plot.left,
                    markerBandTop - 8,
                    plot.width,
                    plot.top - markerBandTop + 10
                );
            }

            const yTicks = 4;
            mainCtx.save();
            mainCtx.font = "600 11px 'Space Grotesk', sans-serif";
            mainCtx.textAlign = "right";
            mainCtx.textBaseline = "middle";
            for (let index = 0; index <= yTicks; index += 1) {
                const ratio = index / yTicks;
                const y = plot.top + ratio * plot.height;
                const value = maxValue - ratio * range;

                mainCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
                mainCtx.beginPath();
                mainCtx.moveTo(plot.left, y);
                mainCtx.lineTo(plot.right, y);
                mainCtx.stroke();

                mainCtx.fillStyle = "rgba(231, 236, 245, 0.78)";
                mainCtx.fillText(formatAxisNumber(value), plot.left - 10, y);
            }
            mainCtx.restore();

            const xTickCount = Math.min(6, config.timeline.length);
            const xStepCount = Math.max(Math.floor((config.timeline.length - 1) / Math.max(xTickCount - 1, 1)), 1);
            mainCtx.save();
            mainCtx.font = "600 11px 'Space Grotesk', sans-serif";
            mainCtx.textAlign = "center";
            mainCtx.textBaseline = "top";
            for (let index = 0; index < config.timeline.length; index += xStepCount) {
                const x = plot.left + stepX * index;
                mainCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
                mainCtx.beginPath();
                mainCtx.moveTo(x, plot.bottom);
                mainCtx.lineTo(x, plot.bottom + 6);
                mainCtx.stroke();

                mainCtx.fillStyle = "rgba(231, 236, 245, 0.78)";
                mainCtx.fillText(shortDateFormatter.format(config.timeline[index]), x, plot.bottom + 10);

                if (index + xStepCount >= config.timeline.length - 1) {
                    break;
                }
            }
            mainCtx.restore();

            mainCtx.strokeStyle = "rgba(255, 255, 255, 0.18)";
            mainCtx.beginPath();
            mainCtx.moveTo(plot.left, plot.top);
            mainCtx.lineTo(plot.left, plot.bottom);
            mainCtx.lineTo(plot.right, plot.bottom);
            mainCtx.stroke();

            config.markers.forEach((marker, markerIndex) => {
                const localIndex = marker.globalIndex - config.window.start;
                const x = plot.left + stepX * localIndex;
                const labelY = markerBandTop + (markerIndex % 2) * (markerLabelHeight + markerRowGap);

                mainCtx.save();
                mainCtx.setLineDash([6, 6]);
                mainCtx.strokeStyle = "rgba(247, 201, 72, 0.85)";
                mainCtx.beginPath();
                mainCtx.moveTo(x, plot.top);
                mainCtx.lineTo(x, plot.bottom);
                mainCtx.stroke();
                mainCtx.restore();

                const labelText = marker.label;
                mainCtx.font = "600 10px 'Space Grotesk', sans-serif";
                const labelWidth = mainCtx.measureText(labelText).width + 12;
                const labelLeft = clamp(x - labelWidth / 2, plot.left, plot.right - labelWidth);
                mainCtx.fillStyle = "rgba(247, 201, 72, 0.18)";
                mainCtx.fillRect(labelLeft, labelY, labelWidth, markerLabelHeight);
                mainCtx.strokeStyle = "rgba(247, 201, 72, 0.7)";
                mainCtx.strokeRect(labelLeft, labelY, labelWidth, markerLabelHeight);
                mainCtx.fillStyle = "#f7c948";
                mainCtx.textAlign = "center";
                mainCtx.textBaseline = "middle";
                mainCtx.fillText(labelText, labelLeft + labelWidth / 2, labelY + markerLabelHeight / 2);
            });

            config.datasets.forEach((series) => {
                const coords = [];
                mainCtx.beginPath();
                mainCtx.lineWidth = 2.4;
                mainCtx.strokeStyle = series.color;

                series.points.forEach((value, index) => {
                    const x = plot.left + stepX * index;
                    const normalized = (value - minValue) / range;
                    const y = plot.top + (1 - normalized) * plot.height;

                    coords.push({
                        x,
                        y,
                        value,
                        rawValue: series.rawPoints[index],
                        date: config.timeline[index],
                        index,
                        series
                    });

                    if (index === 0) {
                        mainCtx.moveTo(x, y);
                    } else {
                        mainCtx.lineTo(x, y);
                    }
                });

                mainCtx.stroke();
                series.coords = coords;
            });

            if (state.hoverPoint) {
                mainCtx.save();
                mainCtx.fillStyle = state.hoverPoint.series.color;
                mainCtx.beginPath();
                mainCtx.arc(state.hoverPoint.x, state.hoverPoint.y, 5, 0, Math.PI * 2);
                mainCtx.fill();
                mainCtx.strokeStyle = "rgba(4, 6, 10, 0.9)";
                mainCtx.lineWidth = 2;
                mainCtx.stroke();
                mainCtx.restore();
            }

            if (state.zoomDrag) {
                const left = Math.min(state.zoomDrag.startX, state.zoomDrag.currentX);
                const width = Math.abs(state.zoomDrag.currentX - state.zoomDrag.startX);
                mainCtx.fillStyle = "rgba(100, 233, 255, 0.14)";
                mainCtx.fillRect(left, plot.top, width, plot.height);
                mainCtx.strokeStyle = "rgba(100, 233, 255, 0.7)";
                mainCtx.strokeRect(left, plot.top, width, plot.height);
            }

            mainCtx.fillStyle = "rgba(231, 236, 245, 0.95)";
            mainCtx.font = "600 13px 'Space Grotesk', sans-serif";
            mainCtx.textAlign = "left";
            mainCtx.textBaseline = "middle";
            mainCtx.fillText(
                `${state.metricMode === "indexed" ? "Indexed view (window start = 100)" : "Raw player counters"}`,
                plot.left,
                chartTitleY
            );
            mainCtx.fillStyle = "rgba(138, 145, 167, 0.95)";
            mainCtx.font = "500 11px 'Space Grotesk', sans-serif";
            mainCtx.fillText(
                `${longDateFormatter.format(config.timeline[0])} to ${longDateFormatter.format(
                    config.timeline[config.timeline.length - 1]
                )}`,
                plot.left,
                chartSubtitleY
            );

            state.mainRenderMeta = {
                plot,
                stepX,
                timeline: config.timeline,
                datasets: config.datasets
            };
        };

        const drawOverviewChart = (config) => {
            if (!config) {
                drawCanvasPlaceholder(
                    overviewCtx,
                    compareOverviewCanvas,
                    "Overview brush will appear here",
                    "Select two games to pan and resize the visible window."
                );
                state.overviewRenderMeta = null;
                return;
            }

            overviewCtx.clearRect(0, 0, compareOverviewCanvas.width, compareOverviewCanvas.height);
            const padding = {
                top: 18,
                right: 22,
                bottom: 30,
                left: 18
            };
            const plot = {
                left: padding.left,
                top: padding.top,
                right: compareOverviewCanvas.width - padding.right,
                bottom: compareOverviewCanvas.height - padding.bottom
            };
            plot.width = plot.right - plot.left;
            plot.height = plot.bottom - plot.top;

            const stepX = plot.width / Math.max(config.fullTimeline.length - 1, 1);

            overviewCtx.fillStyle = "rgba(6, 10, 16, 0.72)";
            overviewCtx.fillRect(0, 0, compareOverviewCanvas.width, compareOverviewCanvas.height);
            overviewCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
            overviewCtx.strokeRect(plot.left, plot.top, plot.width, plot.height);

            config.selectedSeries.forEach((series) => {
                const peak = Math.max(...series.fullPoints, 1);
                overviewCtx.beginPath();
                overviewCtx.lineWidth = 1.4;
                overviewCtx.strokeStyle = `${series.color}99`;

                series.fullPoints.forEach((value, index) => {
                    const x = plot.left + stepX * index;
                    const normalized = peak ? value / peak : 0;
                    const y = plot.bottom - normalized * plot.height;
                    if (index === 0) {
                        overviewCtx.moveTo(x, y);
                    } else {
                        overviewCtx.lineTo(x, y);
                    }
                });

                overviewCtx.stroke();
            });

            const brushLeft = plot.left + stepX * config.window.start;
            const brushRight = plot.left + stepX * config.window.end;

            overviewCtx.fillStyle = "rgba(4, 6, 10, 0.46)";
            overviewCtx.fillRect(plot.left, plot.top, Math.max(brushLeft - plot.left, 0), plot.height);
            overviewCtx.fillRect(brushRight, plot.top, Math.max(plot.right - brushRight, 0), plot.height);

            overviewCtx.fillStyle = "rgba(100, 233, 255, 0.14)";
            overviewCtx.fillRect(brushLeft, plot.top, Math.max(brushRight - brushLeft, 0), plot.height);
            overviewCtx.strokeStyle = "rgba(100, 233, 255, 0.8)";
            overviewCtx.lineWidth = 1.6;
            overviewCtx.strokeRect(brushLeft, plot.top, Math.max(brushRight - brushLeft, 1), plot.height);

            overviewCtx.fillStyle = "rgba(100, 233, 255, 0.95)";
            overviewCtx.fillRect(brushLeft - 3, plot.top + 8, 6, plot.height - 16);
            overviewCtx.fillRect(brushRight - 3, plot.top + 8, 6, plot.height - 16);

            const tickIndices = [0, Math.floor((config.fullTimeline.length - 1) / 2), config.fullTimeline.length - 1];
            overviewCtx.fillStyle = "rgba(231, 236, 245, 0.78)";
            overviewCtx.font = "600 10px 'Space Grotesk', sans-serif";
            overviewCtx.textAlign = "center";
            overviewCtx.textBaseline = "top";
            tickIndices.forEach((index) => {
                const x = plot.left + stepX * index;
                overviewCtx.fillText(shortDateFormatter.format(config.fullTimeline[index]), x, plot.bottom + 8);
            });

            state.overviewRenderMeta = {
                plot,
                stepX,
                brushLeft,
                brushRight
            };
        };

        const renderCompare = (statusOverride = null) => {
            renderModeButtons();
            renderSelectedChips();
            renderSearchResults();
            renderMarkerList();
            hideCompareTooltip();
            state.hoverPoint = null;

            if (!dataStore.ready) {
                compareSearchInput.disabled = true;
                renderLegend([]);
                renderSummary(null);
                drawCompareChart(null);
                drawOverviewChart(null);
                syncCompareControls();
                if (statusOverride) {
                    setCompareStatus(statusOverride.message, statusOverride.isError);
                } else {
                    setCompareStatus("Loading live telemetry...");
                }
                return;
            }

            compareSearchInput.disabled = false;
            ensureVisibleWindow();
            const selectedSeries = getSelectedSeries();
            renderLegend(selectedSeries);

            if (selectedSeries.length < COMPARE_MIN_SELECTION) {
                state.currentConfig = null;
                renderSummary(null);
                drawCompareChart(null);
                drawOverviewChart(null);
                syncCompareControls();
                if (statusOverride) {
                    setCompareStatus(statusOverride.message, statusOverride.isError);
                } else {
                    setCompareStatus(
                        `Select ${COMPARE_MIN_SELECTION}-${COMPARE_MAX_SELECTION} games to start comparing timelines.`
                    );
                }
                return;
            }

            const config = buildCompareConfig();
            state.currentConfig = config;
            renderSummary(config);
            drawCompareChart(config);
            drawOverviewChart(config);
            syncCompareControls();

            if (statusOverride) {
                setCompareStatus(statusOverride.message, statusOverride.isError);
                return;
            }

            setCompareStatus(
                `Comparing ${config.datasets.length} games in ${
                    state.metricMode === "indexed" ? "indexed" : "raw"
                } mode across ${config.timeline.length} days.`
            );
        };

        const addSelection = (appId) => {
            if (!dataStore.ready) {
                return;
            }

            if (state.selectedAppIds.includes(appId)) {
                renderCompare({
                    message: "That game is already on the comparer chart.",
                    isError: true
                });
                return;
            }

            if (state.selectedAppIds.length >= COMPARE_MAX_SELECTION) {
                renderCompare({
                    message: `You can compare up to ${COMPARE_MAX_SELECTION} games at once.`,
                    isError: true
                });
                return;
            }

            state.selectedAppIds.push(appId);
            compareSearchInput.value = "";
            state.searchOpen = true;
            renderCompare({
                message: `${dataStore.metadata.get(appId)?.name || "Game"} added to the comparison chart.`,
                isError: false
            });
            compareSearchInput.focus();
        };

        const removeSelection = (appId) => {
            state.selectedAppIds = state.selectedAppIds.filter((selectedAppId) => selectedAppId !== appId);
            renderCompare();
        };

        const resetVisibleWindow = (statusMessage = "Zoom reset to the full 91-day timeline.") => {
            if (!dataStore.ready) {
                return;
            }

            state.visibleWindow = {
                start: 0,
                end: dataStore.fullTimeline.length - 1
            };
            renderCompare({
                message: statusMessage,
                isError: false
            });
        };

        const findNearestPoint = (point) => {
            if (!state.currentConfig || !state.mainRenderMeta || state.zoomDrag) {
                return null;
            }

            let nearest = null;
            const threshold = 14;

            state.currentConfig.datasets.forEach((series) => {
                series.coords.forEach((coord) => {
                    const dx = coord.x - point.x;
                    const dy = coord.y - point.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= threshold && (!nearest || distance < nearest.distance)) {
                        nearest = { ...coord, distance };
                    }
                });
            });

            return nearest;
        };

        const showCompareTooltip = (nearestPoint, x, y) => {
            const detailLine =
                state.metricMode === "indexed"
                    ? `${formatMetricValue(nearestPoint.value, "indexed")} | ${formatMetricValue(
                          nearestPoint.rawValue,
                          "raw"
                      )}`
                    : formatMetricValue(nearestPoint.value, "raw");

            compareTooltip.innerHTML = `
                <strong>${escapeHtml(nearestPoint.series.meta.name)}</strong>
                <span>${escapeHtml(detailLine)}</span>
                <span>${escapeHtml(getCompanyLabel(nearestPoint.series.meta))}</span>
                <span>${escapeHtml(longDateFormatter.format(nearestPoint.date))}</span>
            `;
            compareTooltip.style.left = `${x + 18}px`;
            compareTooltip.style.top = `${y - 12}px`;
            compareTooltip.hidden = false;
        };

        const applyZoomWindow = () => {
            if (!state.zoomDrag || !state.mainRenderMeta || !state.visibleWindow) {
                state.zoomDrag = null;
                return;
            }

            const { plot, stepX, timeline } = state.mainRenderMeta;
            const left = clamp(Math.min(state.zoomDrag.startX, state.zoomDrag.currentX), plot.left, plot.right);
            const right = clamp(Math.max(state.zoomDrag.startX, state.zoomDrag.currentX), plot.left, plot.right);

            state.zoomDrag = null;

            if (right - left < 12) {
                drawCompareChart(state.currentConfig);
                return;
            }

            const startIndex = pixelToIndex(left, plot, stepX, timeline.length);
            const endIndex = pixelToIndex(right, plot, stepX, timeline.length);
            const globalStart = state.visibleWindow.start + Math.min(startIndex, endIndex);
            const globalEnd = state.visibleWindow.start + Math.max(startIndex, endIndex);

            if (globalEnd - globalStart + 1 < MIN_WINDOW_POINTS) {
                renderCompare({
                    message: `Zoom windows must include at least ${MIN_WINDOW_POINTS} days.`,
                    isError: true
                });
                return;
            }

            state.visibleWindow = {
                start: globalStart,
                end: globalEnd
            };
            renderCompare({
                message: `Zoomed into ${globalEnd - globalStart + 1} days of player-counter movement.`,
                isError: false
            });
        };

        const getBrushModeAtPoint = (x) => {
            if (!state.overviewRenderMeta) {
                return null;
            }

            const { brushLeft, brushRight } = state.overviewRenderMeta;
            const handleThreshold = 8;

            if (Math.abs(x - brushLeft) <= handleThreshold) {
                return "resize-left";
            }
            if (Math.abs(x - brushRight) <= handleThreshold) {
                return "resize-right";
            }
            if (x >= brushLeft && x <= brushRight) {
                return "drag";
            }

            return null;
        };

        const updateBrushWindowFromPoint = (clientX, clientY) => {
            if (!state.brushDrag || !state.overviewRenderMeta || !state.visibleWindow) {
                return;
            }

            const { x, y } = getRelativeCanvasPoint(compareOverviewCanvas, clientX, clientY);
            const { plot, stepX } = state.overviewRenderMeta;
            if (y < plot.top - 18 || y > plot.bottom + 18) {
                return;
            }

            if (state.brushDrag.mode === "drag") {
                const width = state.brushDrag.end - state.brushDrag.start;
                const desiredLeft = clamp(x - state.brushDrag.offsetX, plot.left, plot.right);
                let nextStart = pixelToIndex(desiredLeft, plot, stepX, dataStore.fullTimeline.length);
                nextStart = clamp(nextStart, 0, dataStore.fullTimeline.length - 1 - width);
                state.visibleWindow = {
                    start: nextStart,
                    end: nextStart + width
                };
            } else if (state.brushDrag.mode === "resize-left") {
                const nextStart = clamp(
                    pixelToIndex(x, plot, stepX, dataStore.fullTimeline.length),
                    0,
                    state.visibleWindow.end - MIN_WINDOW_POINTS + 1
                );
                state.visibleWindow = {
                    start: nextStart,
                    end: state.visibleWindow.end
                };
            } else if (state.brushDrag.mode === "resize-right") {
                const nextEnd = clamp(
                    pixelToIndex(x, plot, stepX, dataStore.fullTimeline.length),
                    state.visibleWindow.start + MIN_WINDOW_POINTS - 1,
                    dataStore.fullTimeline.length - 1
                );
                state.visibleWindow = {
                    start: state.visibleWindow.start,
                    end: nextEnd
                };
            }

            renderCompare();
        };

        compareSearchInput.addEventListener("focus", () => {
            state.searchOpen = true;
            renderSearchResults();
        });

        compareSearchInput.addEventListener("input", () => {
            state.searchOpen = true;
            renderSearchResults();
        });

        compareSuggestions.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });

        compareSuggestions.addEventListener("click", (event) => {
            const button = event.target.closest("[data-appid]");
            if (!button) {
                return;
            }
            addSelection(button.dataset.appid);
        });

        compareSelected.addEventListener("click", (event) => {
            const button = event.target.closest("[data-remove-appid]");
            if (!button) {
                return;
            }
            removeSelection(button.dataset.removeAppid);
        });

        compareMarkerList.addEventListener("click", (event) => {
            const button = event.target.closest("[data-remove-marker]");
            if (!button) {
                return;
            }

            state.manualMarkers = state.manualMarkers.filter((marker) => marker.id !== button.dataset.removeMarker);
            renderCompare({
                message: "Marker removed from the timeline.",
                isError: false
            });
        });

        compareModeToggle.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-mode]");
            if (!button || button.dataset.mode === state.metricMode) {
                return;
            }

            state.metricMode = button.dataset.mode;
            renderCompare({
                message:
                    state.metricMode === "indexed"
                        ? "Indexed mode active. Each series now rebases to the visible window start."
                        : "Raw mode active. Showing actual daily player counts.",
                isError: false
            });
        });

        compareResetButton.addEventListener("click", () => {
            resetVisibleWindow();
        });

        compareMarkerForm.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!dataStore.ready) {
                renderCompare({
                    message: "Telemetry is still loading, so markers cannot be added yet.",
                    isError: true
                });
                return;
            }

            const markerDate = createCalendarDate(compareMarkerDateInput.value);
            const markerLabel = compareMarkerLabelInput.value.trim();

            if (!markerDate || !markerLabel) {
                renderCompare({
                    message: "Add both a marker date and a short label.",
                    isError: true
                });
                return;
            }

            if (
                getUtcDayValue(markerDate) < getUtcDayValue(dataStore.dateRange.start) ||
                getUtcDayValue(markerDate) > getUtcDayValue(dataStore.dateRange.end)
            ) {
                renderCompare({
                    message: `Markers must stay between ${toDateKey(dataStore.dateRange.start)} and ${toDateKey(
                        dataStore.dateRange.end
                    )}.`,
                    isError: true
                });
                return;
            }

            const marker = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                dateKey: toDateKey(markerDate),
                label: markerLabel
            };
            state.manualMarkers.push(marker);
            state.manualMarkers.sort((left, right) => left.dateKey.localeCompare(right.dateKey));
            compareMarkerLabelInput.value = "";

            renderCompare({
                message: `Marker added for ${marker.label} on ${marker.dateKey}.`,
                isError: false
            });
        });

        compareCanvas.addEventListener("mousedown", (event) => {
            if (!state.currentConfig || !state.mainRenderMeta) {
                return;
            }

            const point = getRelativeCanvasPoint(compareCanvas, event.clientX, event.clientY);
            if (!isPointInPlot(point, state.mainRenderMeta.plot)) {
                return;
            }

            event.preventDefault();
            hideCompareTooltip();
            state.hoverPoint = null;
            state.zoomDrag = {
                startX: point.x,
                currentX: point.x
            };
            drawCompareChart(state.currentConfig);
        });

        compareCanvas.addEventListener("mousemove", (event) => {
            if (!state.currentConfig || state.zoomDrag) {
                return;
            }

            const point = getRelativeCanvasPoint(compareCanvas, event.clientX, event.clientY);
            if (!state.mainRenderMeta || !isPointInPlot(point, state.mainRenderMeta.plot)) {
                if (state.hoverPoint) {
                    state.hoverPoint = null;
                    drawCompareChart(state.currentConfig);
                }
                hideCompareTooltip();
                return;
            }

            const nearest = findNearestPoint(point);
            if (!nearest) {
                if (state.hoverPoint) {
                    state.hoverPoint = null;
                    drawCompareChart(state.currentConfig);
                }
                hideCompareTooltip();
                return;
            }

            const didPointChange =
                !state.hoverPoint ||
                state.hoverPoint.series.appId !== nearest.series.appId ||
                state.hoverPoint.index !== nearest.index;

            if (didPointChange) {
                state.hoverPoint = nearest;
                drawCompareChart(state.currentConfig);
            }

            showCompareTooltip(nearest, point.x, point.y);
        });

        compareCanvas.addEventListener("mouseleave", () => {
            if (state.zoomDrag) {
                return;
            }
            if (state.hoverPoint) {
                state.hoverPoint = null;
                drawCompareChart(state.currentConfig);
            }
            hideCompareTooltip();
        });

        compareCanvas.addEventListener("dblclick", () => {
            if (!dataStore.ready || isFullWindow()) {
                return;
            }
            resetVisibleWindow("Zoom reset from the main chart.");
        });

        compareOverviewCanvas.addEventListener("mousedown", (event) => {
            if (!state.currentConfig || !state.overviewRenderMeta || !state.visibleWindow) {
                return;
            }

            const point = getRelativeCanvasPoint(compareOverviewCanvas, event.clientX, event.clientY);
            const { plot, brushLeft } = state.overviewRenderMeta;

            if (point.y < plot.top || point.y > plot.bottom) {
                return;
            }

            event.preventDefault();
            const brushMode = getBrushModeAtPoint(point.x);

            if (!brushMode) {
                const width = state.visibleWindow.end - state.visibleWindow.start;
                let centeredStart = pixelToIndex(point.x, plot, state.overviewRenderMeta.stepX, dataStore.fullTimeline.length);
                centeredStart = clamp(
                    centeredStart - Math.floor(width / 2),
                    0,
                    dataStore.fullTimeline.length - width - 1
                );
                state.visibleWindow = {
                    start: centeredStart,
                    end: centeredStart + width
                };
                renderCompare({
                    message: "Timeline window moved in the overview brush.",
                    isError: false
                });
                return;
            }

            state.brushDrag = {
                mode: brushMode,
                start: state.visibleWindow.start,
                end: state.visibleWindow.end,
                offsetX: point.x - brushLeft
            };
        });

        document.addEventListener("mousemove", (event) => {
            if (state.zoomDrag && state.mainRenderMeta) {
                const point = getRelativeCanvasPoint(compareCanvas, event.clientX, event.clientY);
                state.zoomDrag.currentX = clamp(point.x, state.mainRenderMeta.plot.left, state.mainRenderMeta.plot.right);
                drawCompareChart(state.currentConfig);
                return;
            }

            if (state.brushDrag) {
                updateBrushWindowFromPoint(event.clientX, event.clientY);
            }
        });

        document.addEventListener("mouseup", () => {
            if (state.zoomDrag) {
                applyZoomWindow();
            }
            if (state.brushDrag) {
                state.brushDrag = null;
            }
        });

        document.addEventListener("click", (event) => {
            if (compareSearchShell && !compareSearchShell.contains(event.target)) {
                state.searchOpen = false;
                renderSearchResults();
            }
        });

        telemetryPromise
            .then(() => {
                if (!dataStore.ready) {
                    renderCompare({
                        message: "Telemetry loaded, but no compare-ready overlap was found.",
                        isError: true
                    });
                    return;
                }

                compareMarkerDateInput.min = toDateKey(dataStore.dateRange.start);
                compareMarkerDateInput.max = toDateKey(dataStore.dateRange.end);
                compareMarkerDateInput.value = toDateKey(dataStore.dateRange.end);
                state.visibleWindow = {
                    start: 0,
                    end: dataStore.fullTimeline.length - 1
                };

                renderCompare({
                    message: `Telemetry ready for ${dataStore.rankedAppIds.length} tracked games. Select ${COMPARE_MIN_SELECTION}-${COMPARE_MAX_SELECTION} titles to compare.`,
                    isError: false
                });
            })
            .catch((error) => {
                console.error(error);
                renderCompare({
                    message: "Failed to load CSV telemetry. Check console.",
                    isError: true
                });
            });
    };

    initTrendModule();
    initCompareModule();
});
