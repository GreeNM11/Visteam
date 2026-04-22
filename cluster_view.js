import {
    easeCubicOut,
    extent,
    forceCollide,
    forceManyBody,
    forceSimulation,
    forceX,
    forceY,
    scaleSqrt,
    select
} from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const CLUSTER_WIDTH = 960;
const CLUSTER_HEIGHT = 640;
const MAX_SELECTED_GENRES = 4;
const ATTRACTOR_COLORS = ["#64e9ff", "#8f7bff", "#f7c948", "#ff8bd2"];
const COMPANY_COLORS = {
    "Large Studio": "#64e9ff",
    "Medium Studio": "#8f7bff",
    Indie: "#f7c948"
};

const getCompanyType = (meta) => {
    if (meta.scope === "large" || meta.studioSize === "Large Studio") {
        return "Large Studio";
    }
    if (meta.scope === "medium" || meta.studioSize === "Medium Studio") {
        return "Medium Studio";
    }
    return "Indie";
};

const getAttractorCoordinates = (genres) => {
    const layout = {
        1: [{ x: 0.5, y: 0.5 }],
        2: [
            { x: 0.3, y: 0.54 },
            { x: 0.7, y: 0.54 }
        ],
        3: [
            { x: 0.5, y: 0.26 },
            { x: 0.29, y: 0.74 },
            { x: 0.71, y: 0.74 }
        ],
        4: [
            { x: 0.29, y: 0.28 },
            { x: 0.71, y: 0.28 },
            { x: 0.29, y: 0.74 },
            { x: 0.71, y: 0.74 }
        ]
    };
    const bounds = {
        left: 72,
        top: 92,
        right: CLUSTER_WIDTH - 72,
        bottom: CLUSTER_HEIGHT - 64
    };
    const positions = layout[genres.length] || [];

    return genres.map((genre, index) => {
        const slot = positions[index];
        const x = bounds.left + (bounds.right - bounds.left) * slot.x;
        const y = bounds.top + (bounds.bottom - bounds.top) * slot.y;
        return {
            genre,
            color: ATTRACTOR_COLORS[index % ATTRACTOR_COLORS.length],
            x,
            y,
            labelWidth: Math.max(104, genre.length * 7.4 + 28)
        };
    });
};

const hashString = (value = "") => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
};

const buildLegendSamples = (values) => {
    if (!values.length) {
        return [];
    }

    const sorted = values.slice().sort((left, right) => left - right);
    const indices = [0, Math.floor((sorted.length - 1) / 2), sorted.length - 1];
    const seen = new Set();

    return indices
        .map((index) => sorted[index])
        .filter((value) => {
            if (!Number.isFinite(value) || seen.has(value)) {
                return false;
            }
            seen.add(value);
            return true;
        });
};

export function initClusterModule(shared) {
    const {
        dataStore,
        telemetryPromise,
        trendSync,
        utils: {
            clamp,
            escapeHtml,
            splitCommaList,
            integerFormatter,
            compactNumberFormatter,
            clampToDataDomain,
            getIndexForDate,
            toDateKey
        }
    } = shared;

    const genreSelect = document.getElementById("clusterGenreSelect");
    const genreChipContainer = document.getElementById("clusterGenreChips");
    const genreHint = document.getElementById("clusterGenreHint");
    const clearButton = document.getElementById("clusterClear");
    const currentDateLabel = document.getElementById("clusterCurrentDate");
    const statusLabel = document.getElementById("clusterStatus");
    const legend = document.getElementById("clusterLegend");
    const chartShell = document.getElementById("clusterChartShell");
    const clusterSvg = document.getElementById("clusterChart");
    const tooltip = document.getElementById("clusterTooltip");
    const emptyState = document.getElementById("clusterEmptyState");

    if (
        !genreSelect ||
        !genreChipContainer ||
        !genreHint ||
        !clearButton ||
        !currentDateLabel ||
        !statusLabel ||
        !legend ||
        !chartShell ||
        !clusterSvg ||
        !tooltip ||
        !emptyState
    ) {
        return;
    }

    const svg = select(clusterSvg).attr("viewBox", `0 0 ${CLUSTER_WIDTH} ${CLUSTER_HEIGHT}`);
    const attractorFieldLayer = svg.append("g").attr("class", "cluster-attractor-field-layer");
    const bubbleLayer = svg.append("g").attr("class", "cluster-bubble-layer");
    const attractorLabelLayer = svg.append("g").attr("class", "cluster-attractor-label-layer");

    const state = {
        catalog: [],
        genreStats: new Map(),
        availableGenres: [],
        selectedGenres: [],
        radiusScale: scaleSqrt().range([12, 40]).domain([1, 10]),
        nodeCache: new Map(),
        simulation: null,
        nodes: [],
        alphaTimeoutId: null,
        activeAppIds: new Set(),
        animationConfig: null,
        configKey: "",
        shared: trendSync.getState()
    };

    const setStatus = (message, isError = false) => {
        statusLabel.textContent = message;
        statusLabel.classList.toggle("is-error", Boolean(isError));
    };

    const setCurrentDateLabel = (value = "--") => {
        currentDateLabel.textContent = `Current Day: ${value}`;
    };

    const setEmptyState = (message) => {
        emptyState.textContent = message;
        emptyState.hidden = false;
    };

    const hideEmptyState = () => {
        emptyState.hidden = true;
    };

    const hideTooltip = () => {
        tooltip.hidden = true;
        bubbleLayer.selectAll(".cluster-bubble").classed("is-hovered", false);
    };

    const formatPlayerCount = (value) => `${integerFormatter.format(Math.round(value || 0))} players`;
    const formatCompactPlayers = (value) => `${compactNumberFormatter.format(value || 0)} players`;
    const formatPlaybackRate = (value = 1) => `${value}x`;

    const syncControls = () => {
        clearButton.disabled = !state.selectedGenres.length;
        genreSelect.disabled = !state.availableGenres.length || state.selectedGenres.length >= MAX_SELECTED_GENRES;

        if (!state.availableGenres.length) {
            genreHint.textContent = "Genre options will appear once the Steam metadata loads.";
        } else if (state.selectedGenres.length >= MAX_SELECTED_GENRES) {
            genreHint.textContent = "Maximum of four genres selected. Remove one to add another.";
        } else {
            genreHint.textContent = `Select up to four genres. ${state.selectedGenres.length} of ${MAX_SELECTED_GENRES} selected.`;
        }
    };

    const renderGenrePicker = () => {
        if (!state.availableGenres.length) {
            genreSelect.innerHTML = `<option value="">Genre list unavailable</option>`;
            genreSelect.value = "";
            return;
        }

        const selectedSet = new Set(state.selectedGenres);
        const availableOptions = state.availableGenres
            .filter((genre) => !selectedSet.has(genre))
            .map((genre) => {
                const stats = state.genreStats.get(genre) || { count: 0 };
                return `<option value="${escapeHtml(genre)}">${escapeHtml(genre)} (${escapeHtml(
                    integerFormatter.format(stats.count)
                )})</option>`;
            })
            .join("");

        genreSelect.innerHTML = `
            <option value="">${state.selectedGenres.length >= MAX_SELECTED_GENRES ? "Maximum genres selected" : "Select a genre"}</option>
            ${availableOptions}
        `;
        genreSelect.value = "";
    };

    const renderSelectedGenres = () => {
        if (!state.availableGenres.length && !state.selectedGenres.length) {
            genreChipContainer.innerHTML = `
                <p class="cluster-selected-empty">Genre filters will appear once the Steam metadata loads.</p>
            `;
            return;
        }

        if (!state.selectedGenres.length) {
            genreChipContainer.innerHTML = `
                <p class="cluster-selected-empty">No genres selected yet. Add 1-4 genres to activate the bubble clusters.</p>
            `;
            return;
        }

        genreChipContainer.innerHTML = state.selectedGenres
            .map((genre) => {
                const stats = state.genreStats.get(genre) || { count: 0 };
                return `
                    <button
                        class="cluster-selected-chip"
                        type="button"
                        data-genre="${escapeHtml(genre)}"
                        aria-label="Remove ${escapeHtml(genre)} from the bubble cluster filters"
                    >
                        <span>${escapeHtml(genre)}</span>
                        <small>${escapeHtml(integerFormatter.format(stats.count))}</small>
                        <strong aria-hidden="true">&times;</strong>
                    </button>
                `;
            })
            .join("");
    };

    const renderLegend = (config) => {
        if (!config?.legendSamples?.length) {
            legend.innerHTML = "";
            return;
        }

        legend.innerHTML = `
            <div class="cluster-legend__group">
                <span class="cluster-legend__title">Company Type</span>
                <div class="cluster-legend__items">
                    ${Object.entries(COMPANY_COLORS)
                        .map(
                            ([label, color]) => `
                                <span class="cluster-legend__item">
                                    <span class="cluster-legend__swatch" style="--swatch:${escapeHtml(color)}"></span>
                                    <span>${escapeHtml(label)}</span>
                                </span>
                            `
                        )
                        .join("")}
                </div>
            </div>
            <div class="cluster-legend__group">
                <span class="cluster-legend__title">Bubble Size</span>
                <div class="cluster-legend__sizes">
                    ${config.legendSamples
                        .map(
                            (sample) => `
                                <span class="cluster-legend__size-item">
                                    <span
                                        class="cluster-legend__size-circle"
                                        style="--size:${Math.round(state.radiusScale(sample) * 2)}px"
                                    ></span>
                                    <span>${escapeHtml(formatCompactPlayers(sample))}</span>
                                </span>
                            `
                        )
                        .join("")}
                </div>
            </div>
        `;
    };

    const renderAttractors = (attractors) => {
        const fieldJoin = attractorFieldLayer
            .selectAll("g.cluster-attractor")
            .data(attractors, (entry) => entry.genre);
        const labelJoin = attractorLabelLayer
            .selectAll("g.cluster-attractor-label")
            .data(attractors, (entry) => entry.genre);

        const fieldEnter = fieldJoin
            .enter()
            .append("g")
            .attr("class", "cluster-attractor")
            .attr("transform", (entry) => `translate(${entry.x}, ${entry.y})`)
            .style("opacity", 0);

        fieldEnter.append("circle").attr("class", "cluster-attractor__halo").attr("r", 0);
        fieldEnter.append("circle").attr("class", "cluster-attractor__ring").attr("r", 0);
        fieldEnter.append("circle").attr("class", "cluster-attractor__core").attr("r", 0);

        const labelEnter = labelJoin
            .enter()
            .append("g")
            .attr("class", "cluster-attractor-label")
            .attr("transform", (entry) => `translate(${entry.x}, ${entry.y})`)
            .style("opacity", 0);

        labelEnter.append("rect").attr("class", "cluster-attractor__label-bg");
        labelEnter.append("text").attr("class", "cluster-attractor__label");

        fieldJoin.exit().transition().duration(220).style("opacity", 0).remove();
        labelJoin.exit().transition().duration(220).style("opacity", 0).remove();

        const mergedFields = fieldEnter.merge(fieldJoin);
        const mergedLabels = labelEnter.merge(labelJoin);

        mergedFields
            .style("--attractor", (entry) => entry.color)
            .transition()
            .duration(350)
            .style("opacity", 1)
            .attr("transform", (entry) => `translate(${entry.x}, ${entry.y})`);

        mergedLabels
            .style("--attractor", (entry) => entry.color)
            .each(function updateLabel(entry) {
                const group = select(this);
                group
                    .select(".cluster-attractor__label-bg")
                    .attr("x", -entry.labelWidth / 2)
                    .attr("y", -86)
                    .attr("width", entry.labelWidth)
                    .attr("height", 28)
                    .attr("rx", 14)
                    .attr("ry", 14);

                group
                    .select(".cluster-attractor__label")
                    .attr("x", 0)
                    .attr("y", -67)
                    .text(entry.genre);
            })
            .transition()
            .duration(350)
            .style("opacity", 1)
            .attr("transform", (entry) => `translate(${entry.x}, ${entry.y})`);

        mergedFields
            .select(".cluster-attractor__halo")
            .transition()
            .duration(500)
            .ease(easeCubicOut)
            .attr("r", 64);

        mergedFields
            .select(".cluster-attractor__ring")
            .transition()
            .duration(500)
            .ease(easeCubicOut)
            .attr("r", 22);

        mergedFields
            .select(".cluster-attractor__core")
            .transition()
            .duration(500)
            .ease(easeCubicOut)
            .attr("r", 10);
    };

    const getBubbleBounds = () => ({
        left: 28,
        top: 28,
        right: CLUSTER_WIDTH - 28,
        bottom: CLUSTER_HEIGHT - 28
    });

    const updateBubblePositions = () => {
        const bounds = getBubbleBounds();

        state.nodes.forEach((node) => {
            node.x = clamp(node.x, bounds.left + node.radius, bounds.right - node.radius);
            const minY = bounds.top + node.radius;
            const maxY = bounds.bottom - node.radius;
            const isInsideVerticalBounds = node.y >= minY && node.y <= maxY;

            if (node.isEntering && !isInsideVerticalBounds) {
                return;
            }

            node.isEntering = false;
            node.y = clamp(node.y, minY, maxY);
        });

        bubbleLayer
            .selectAll("g.cluster-bubble")
            .attr("transform", (node) => `translate(${node.x}, ${node.y})`);
    };

    const positionTooltip = (event) => {
        const rect = chartShell.getBoundingClientRect();
        const left = clamp(event.clientX - rect.left, 120, Math.max(rect.width - 120, 120));
        const top = clamp(event.clientY - rect.top, 96, Math.max(rect.height - 16, 96));

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    };

    const showTooltip = (event, node) => {
        tooltip.hidden = false;
        tooltip.innerHTML = `
            <strong>${escapeHtml(node.name)}</strong>
            <span>${escapeHtml(formatPlayerCount(node.currentPlayers))} on ${escapeHtml(node.dateKey)}</span>
            <span>${escapeHtml(node.companyType)}</span>
            <span>${escapeHtml(node.genres.join(", "))}</span>
        `;
        positionTooltip(event);
    };

    const bindBubbleEvents = (selection) => {
        selection
            .on("mouseenter", function handleMouseEnter(event, node) {
                bubbleLayer.selectAll(".cluster-bubble").classed("is-hovered", false);
                select(this).classed("is-hovered", true).raise();
                showTooltip(event, node);
            })
            .on("mousemove", function handleMouseMove(event, node) {
                select(this).classed("is-hovered", true);
                showTooltip(event, node);
            })
            .on("mouseleave", function handleMouseLeave() {
                select(this).classed("is-hovered", false);
                hideTooltip();
            });
    };

    const renderBubbles = (nodes) => {
        const join = bubbleLayer
            .selectAll("g.cluster-bubble")
            .data(nodes, (node) => node.appId);

        const exiting = join.exit();
        exiting.classed("is-hovered", false);
        exiting.select(".cluster-bubble__halo").transition().duration(220).attr("r", 0);
        exiting.select(".cluster-bubble__body").transition().duration(220).attr("r", 0);
        exiting.transition().duration(220).style("opacity", 0).remove();

        const enter = join
            .enter()
            .append("g")
            .attr("class", "cluster-bubble")
            .attr("transform", (node) => `translate(${node.x}, ${node.y})`)
            .style("opacity", 0);

        enter
            .append("circle")
            .attr("class", "cluster-bubble__halo")
            .attr("r", 0)
            .attr("fill", "none");

        enter
            .append("circle")
            .attr("class", "cluster-bubble__body")
            .attr("r", 0)
            .attr("fill", (node) => COMPANY_COLORS[node.companyType] || COMPANY_COLORS.Indie);

        const merged = enter.merge(join);
        bindBubbleEvents(merged);
        merged.style("--bubble", (node) => COMPANY_COLORS[node.companyType] || COMPANY_COLORS.Indie);

        merged
            .select(".cluster-bubble__halo")
            .transition()
            .duration(320)
            .ease(easeCubicOut)
            .attr("r", (node) => node.radius + 4)
            .attr("stroke", (node) => COMPANY_COLORS[node.companyType] || COMPANY_COLORS.Indie);

        merged
            .select(".cluster-bubble__body")
            .transition()
            .duration(420)
            .ease(easeCubicOut)
            .attr("r", (node) => node.radius)
            .attr("fill", (node) => COMPANY_COLORS[node.companyType] || COMPANY_COLORS.Indie);

        enter.transition().duration(260).style("opacity", 1);
        join.transition().duration(260).style("opacity", 1);
    };

    const stopSimulation = () => {
        if (state.alphaTimeoutId) {
            window.clearTimeout(state.alphaTimeoutId);
            state.alphaTimeoutId = null;
        }
        if (state.simulation) {
            state.simulation.stop();
            state.simulation.nodes([]);
        }
        state.nodes = [];
        state.activeAppIds = new Set();
    };

    const ensureSimulation = () => {
        if (state.simulation) {
            return;
        }

        state.simulation = forceSimulation([])
            .velocityDecay(0.24)
            .alphaDecay(0.08)
            .on("tick", updateBubblePositions);
    };

    const restartSimulation = () => {
        ensureSimulation();
        state.simulation.nodes(state.nodes);
        state.simulation.force(
            "x",
            forceX((node) => node.targetX).strength((node) => (node.matchedGenres.length > 1 ? 0.16 : 0.2))
        );
        state.simulation.force("y", forceY((node) => node.targetY).strength(0.2));
        state.simulation.force("charge", forceManyBody().strength((node) => -Math.max(18, node.radius * 1.65)));
        state.simulation.force(
            "collide",
            forceCollide()
                .radius((node) => node.radius + 4)
                .iterations(2)
        );
        state.simulation.alphaTarget(0.06).alpha(0.95).restart();

        if (state.alphaTimeoutId) {
            window.clearTimeout(state.alphaTimeoutId);
        }
        state.alphaTimeoutId = window.setTimeout(() => {
            if (state.simulation) {
                state.simulation.alphaTarget(0);
            }
            state.alphaTimeoutId = null;
        }, 650);
    };

    const buildAnimationConfig = (sharedState) => {
        if (
            !dataStore.ready ||
            !dataStore.dateRange ||
            !sharedState.startDate ||
            !sharedState.endDate ||
            !state.selectedGenres.length
        ) {
            return null;
        }

        const range = clampToDataDomain(sharedState.startDate, sharedState.endDate);
        const startIndex = getIndexForDate(range.start);
        const endIndex = getIndexForDate(range.end);
        const timeline = dataStore.fullTimeline.slice(startIndex, endIndex + 1);

        if (!timeline.length) {
            return null;
        }

        const selectedSet = new Set(state.selectedGenres);
        const targetScope = sharedState.scope === "all" ? null : sharedState.scope;
        const attractors = getAttractorCoordinates(state.selectedGenres);
        const universe = state.catalog
            .map((game) => {
                if (targetScope && game.scope !== targetScope) {
                    return null;
                }

                const matchedGenres = game.genres.filter((genre) => selectedSet.has(genre));
                if (!matchedGenres.length) {
                    return null;
                }

                return {
                    ...game,
                    matchedGenres
                };
            })
            .filter(Boolean);

        const positiveValues = [];
        const frames = timeline.map((date, localIndex) => {
            const globalIndex = startIndex + localIndex;
            const dateKey = toDateKey(date);

            const visibleGames = universe
                .map((game) => {
                    const currentPlayers = Number(game.points?.[globalIndex] || 0);
                    if (currentPlayers <= 0) {
                        return null;
                    }

                    positiveValues.push(currentPlayers);
                    return {
                        ...game,
                        currentPlayers,
                        dateKey
                    };
                })
                .filter(Boolean)
                .sort(
                    (left, right) =>
                        right.currentPlayers - left.currentPlayers || left.name.localeCompare(right.name)
                )
                .slice(0, sharedState.topN || 10);

            return {
                date,
                dateKey,
                visibleGames
            };
        });

        const legendSamples = buildLegendSamples(positiveValues);
        const [minValue = 1, maxValue = 10] = extent(positiveValues);

        return {
            range,
            timeline,
            startIndex,
            endIndex,
            selectedGenres: state.selectedGenres.slice(),
            scope: sharedState.scope,
            topN: sharedState.topN || 10,
            playbackRate: sharedState.playbackRate || 1,
            attractors,
            frames,
            hasAnyPositive: positiveValues.length > 0,
            scaleExtent: [
                Math.max(1, minValue || 1),
                Math.max(Math.max(1, minValue || 1) + 1, maxValue || 10)
            ],
            legendSamples
        };
    };

    const buildConfigKey = (sharedState) => {
        const startKey = sharedState.startDate ? toDateKey(sharedState.startDate) : "none";
        const endKey = sharedState.endDate ? toDateKey(sharedState.endDate) : "none";
        return [
            sharedState.topN || 10,
            sharedState.scope || "all",
            sharedState.playbackRate || 1,
            startKey,
            endKey,
            state.selectedGenres.join("|")
        ].join("::");
    };

    const getEntrySeed = (appId, frameIndex) => hashString(appId) + frameIndex * 17;

    const buildNodes = (games, attractors, frameIndex) => {
        const previousActiveAppIds = new Set(state.activeAppIds);
        const attractorByGenre = new Map(attractors.map((attractor) => [attractor.genre, attractor]));
        const bounds = getBubbleBounds();

        return games.map((game) => {
            // Use the first matched dataset genre as the primary cluster target.
            const primaryGenre = game.matchedGenres[0] || null;
            const primaryAttractor = attractorByGenre.get(primaryGenre);
            const fallbackAttractor = game.matchedGenres
                .map((genre) => attractorByGenre.get(genre))
                .find(Boolean);
            const resolvedAttractor = primaryAttractor || fallbackAttractor || { x: CLUSTER_WIDTH / 2, y: CLUSTER_HEIGHT / 2 };
            const targetX = resolvedAttractor.x;
            const targetY = resolvedAttractor.y;
            const radius = state.radiusScale(Math.max(1, game.currentPlayers));
            const cachedNode = state.nodeCache.get(game.appId) || {
                appId: game.appId,
                x: targetX,
                y: targetY,
                vx: 0,
                vy: 0
            };

            if (!previousActiveAppIds.has(game.appId)) {
                const seed = getEntrySeed(game.appId, frameIndex);
                const direction = seed % 2 === 0 ? "top" : "bottom";
                const offset = ((seed % 11) - 5) * 12;
                cachedNode.x = clamp(targetX + offset, bounds.left + radius, bounds.right - radius);
                cachedNode.y = direction === "top" ? -radius - 48 : CLUSTER_HEIGHT + radius + 48;
                cachedNode.vx = 0;
                cachedNode.vy = 0;
                cachedNode.isEntering = true;
            }

            Object.assign(cachedNode, {
                ...game,
                primaryGenre,
                radius,
                targetX,
                targetY
            });

            state.nodeCache.set(game.appId, cachedNode);
            return cachedNode;
        });
    };

    const buildFrameStatus = (config, frame, frameIndex, mode) => {
        const prefix =
            mode === "playback"
                ? "Animating"
                : mode === "paused"
                  ? "Paused"
                  : mode === "complete"
                    ? "Completed"
                    : "Previewing";
        const speedLabel = formatPlaybackRate(config.playbackRate);

        if (!frame.visibleGames.length) {
            const durationSummary =
                mode === "playback"
                    ? `${frameIndex + 1} of ${config.timeline.length} days at ${speedLabel}.`
                    : mode === "complete"
                      ? "Reached the end of the selected window."
                      : mode === "paused"
                        ? `Playback is paused at ${speedLabel}.`
                        : `Press Start in Trends to animate ${config.timeline.length} days at ${speedLabel}.`;

            return `${prefix} ${frame.dateKey}. No titles are active in the selected genres for this day. ${durationSummary}`;
        }

        const durationSummary =
            mode === "playback"
                ? `${frameIndex + 1} of ${config.timeline.length} days at ${speedLabel}.`
                : mode === "complete"
                  ? "Reached the end of the selected window."
                  : mode === "paused"
                    ? `Playback is paused at ${speedLabel}.`
                    : `Press Start in Trends to animate ${config.timeline.length} days at ${speedLabel}.`;

        return `${prefix} ${frame.visibleGames.length} titles on ${frame.dateKey}. Active genres: ${config.selectedGenres.join(
            ", "
        )}. ${durationSummary}`;
    };

    const renderFrame = (config, frameIndex, mode = "preview") => {
        const safeFrameIndex = clamp(frameIndex, 0, Math.max(config.frames.length - 1, 0));

        renderAttractors(config.attractors);
        renderLegend(config);

        const frame = config.frames[safeFrameIndex];
        if (!frame) {
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel("--");
            setEmptyState("No cluster frames are available for that date range.");
            setStatus("No cluster frames are available for that date range.", true);
            return;
        }

        setCurrentDateLabel(frame.dateKey);
        hideTooltip();

        if (!frame.visibleGames.length) {
            renderBubbles([]);
            stopSimulation();
            setEmptyState(`No matched titles are active on ${frame.dateKey}.`);
            setStatus(buildFrameStatus(config, frame, safeFrameIndex, mode));
            return;
        }

        hideEmptyState();
        state.nodes = buildNodes(frame.visibleGames, config.attractors, safeFrameIndex);
        state.activeAppIds = new Set(state.nodes.map((node) => node.appId));

        renderBubbles(state.nodes);
        updateBubblePositions();
        restartSimulation();
        setStatus(buildFrameStatus(config, frame, safeFrameIndex, mode));
    };

    const getRenderMode = (eventType) => {
        if (eventType === "pause" || state.shared.playbackStatus === "paused") {
            return "paused";
        }
        if (eventType === "complete" || state.shared.playbackStatus === "complete") {
            return "complete";
        }
        if (
            eventType === "start" ||
            eventType === "resume" ||
            eventType === "frame" ||
            state.shared.playbackStatus === "running"
        ) {
            return "playback";
        }
        return "preview";
    };

    const syncFromSharedState = (eventType = "reset") => {
        renderGenrePicker();
        renderSelectedGenres();
        syncControls();

        if (!dataStore.ready) {
            state.animationConfig = null;
            renderLegend(null);
            renderAttractors([]);
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel("--");
            setEmptyState("Steam telemetry is unavailable for the cluster view.");
            setStatus("Cluster data could not be loaded.", true);
            return;
        }

        if (!state.selectedGenres.length) {
            state.animationConfig = null;
            renderLegend(null);
            renderAttractors([]);
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel("--");
            setEmptyState("Pick 1-4 genres to create attractor zones on the Trends timeline.");
            setStatus("Choose at least one genre to preview the bubble clusters.");
            return;
        }

        if (!state.shared.startDate || !state.shared.endDate) {
            state.animationConfig = null;
            renderLegend(null);
            renderAttractors([]);
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel("--");
            setEmptyState("Waiting for the Trends controls to initialize the shared timeline.");
            setStatus("Waiting for the Trends controls to publish a valid time window.");
            return;
        }

        const configKey = buildConfigKey(state.shared);
        const shouldRebuild =
            !state.animationConfig || eventType === "reset" || eventType === "init" || configKey !== state.configKey;
        const nextConfig = shouldRebuild ? buildAnimationConfig(state.shared) : state.animationConfig;

        if (!nextConfig) {
            state.animationConfig = null;
            state.configKey = "";
            renderLegend(null);
            renderAttractors([]);
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel("--");
            setEmptyState("The selected Trends time window could not be prepared for the bubble view.");
            setStatus("No valid cluster range was produced for the shared Trends controls.", true);
            return;
        }

        state.animationConfig = nextConfig;
        state.configKey = configKey;
        state.radiusScale.domain(nextConfig.scaleExtent);

        if (!nextConfig.hasAnyPositive) {
            renderLegend(nextConfig);
            renderAttractors(nextConfig.attractors);
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel(nextConfig.timeline[0] ? toDateKey(nextConfig.timeline[0]) : "--");
            setEmptyState("No matched titles are active anywhere in that shared date window.");
            setStatus("No games with active players matched the selected genres in that Trends range.", true);
            return;
        }

        const frameIndex = clamp(state.shared.frameIndex || 0, 0, nextConfig.frames.length - 1);
        renderFrame(nextConfig, frameIndex, getRenderMode(eventType));
    };

    genreSelect.addEventListener("change", () => {
        const genre = genreSelect.value;
        if (!genre || state.selectedGenres.includes(genre) || state.selectedGenres.length >= MAX_SELECTED_GENRES) {
            genreSelect.value = "";
            return;
        }

        state.selectedGenres = [...state.selectedGenres, genre];
        genreSelect.value = "";
        syncFromSharedState(state.shared.playbackStatus === "running" ? "frame" : "reset");
    });

    genreChipContainer.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-genre]");
        if (!button) {
            return;
        }

        const genre = button.dataset.genre;
        if (!genre) {
            return;
        }

        state.selectedGenres = state.selectedGenres.filter((entry) => entry !== genre);
        syncFromSharedState(state.shared.playbackStatus === "running" ? "frame" : "reset");
    });

    clearButton.addEventListener("click", () => {
        state.selectedGenres = [];
        syncFromSharedState("reset");
    });

    trendSync.subscribe((snapshot, eventType) => {
        state.shared = snapshot;
        if (eventType === "selection") {
            return;
        }
        syncFromSharedState(eventType);
    });

    setCurrentDateLabel("--");
    setStatus("Loading cluster telemetry...");
    syncControls();
    renderGenrePicker();
    renderSelectedGenres();

    telemetryPromise
        .then(() => {
            if (!dataStore.ready) {
                syncFromSharedState("reset");
                return;
            }

            state.catalog = dataStore.rankedAppIds
                .map((appId) => {
                    const meta = dataStore.metadata.get(appId);
                    const points = dataStore.pointsById.get(appId);
                    if (!meta || !points?.length) {
                        return null;
                    }

                    return {
                        appId: meta.appId,
                        name: meta.name,
                        genres: splitCommaList(meta.genres),
                        companyType: getCompanyType(meta),
                        studioSize: meta.studioSize || getCompanyType(meta),
                        scope: meta.scope,
                        points
                    };
                })
                .filter(Boolean)
                .filter((entry) => entry.genres.length);

            const genreStats = new Map();
            state.catalog.forEach((game) => {
                game.genres.forEach((genre) => {
                    if (!genreStats.has(genre)) {
                        genreStats.set(genre, {
                            count: 0
                        });
                    }

                    genreStats.get(genre).count += 1;
                });
            });

            state.genreStats = genreStats;
            state.availableGenres = Array.from(genreStats.entries())
                .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
                .map(([genre]) => genre);

            renderGenrePicker();
            renderSelectedGenres();
            syncControls();
            syncFromSharedState("reset");
        })
        .catch((error) => {
            console.error("Cluster telemetry failed to load", error);
            state.animationConfig = null;
            renderLegend(null);
            renderAttractors([]);
            renderBubbles([]);
            stopSimulation();
            setCurrentDateLabel("--");
            setEmptyState("The bubble cluster view could not load the Steam metadata.");
            setStatus("Failed to load cluster telemetry.", true);
            syncControls();
        });
}
