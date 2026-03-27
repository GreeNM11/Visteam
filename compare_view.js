export function initCompareModule(shared) {
    const {
        dataStore,
        telemetryPromise,
        constants: { COLOR_PALETTE, COMPARE_MIN_SELECTION, COMPARE_MAX_SELECTION, MIN_WINDOW_POINTS },
        utils: {
            clamp,
            escapeHtml,
            formatAxisNumber,
            formatMetricValue,
            formatRawChange,
            formatIndexedChange,
            formatPercentChange,
            getCompanyLabel,
            createCalendarDate,
            toDateKey,
            longDateFormatter,
            shortDateFormatter,
            getRelativeCanvasPoint,
            isPointInPlot,
            pixelToIndex,
            drawCanvasPlaceholder,
            getUtcDayValue
        }
    } = shared;

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
            mainCtx.fillRect(plot.left, markerBandTop - 8, plot.width, plot.top - markerBandTop + 10);
            mainCtx.strokeStyle = "rgba(247, 201, 72, 0.14)";
            mainCtx.strokeRect(plot.left, markerBandTop - 8, plot.width, plot.top - markerBandTop + 10);
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
}
