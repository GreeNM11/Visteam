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
const CLUSTER_HEIGHT = 560;
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

export function initClusterModule(shared) {
    const {
        dataStore,
        telemetryPromise,
        utils: { clamp, escapeHtml, splitCommaList, integerFormatter, compactNumberFormatter }
    } = shared;

    const genreChipContainer = document.getElementById("clusterGenreChips");
    const topCountSelect = document.getElementById("clusterTopCount");
    const clearButton = document.getElementById("clusterClear");
    const statusLabel = document.getElementById("clusterStatus");
    const legend = document.getElementById("clusterLegend");
    const chartShell = document.getElementById("clusterChartShell");
    const clusterSvg = document.getElementById("clusterChart");
    const tooltip = document.getElementById("clusterTooltip");
    const emptyState = document.getElementById("clusterEmptyState");

    if (
        !genreChipContainer ||
        !topCountSelect ||
        !clearButton ||
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
        topN: Number(topCountSelect.value) || 15,
        catalog: [],
        genreStats: new Map(),
        availableGenres: [],
        selectedGenres: [],
        radiusScale: scaleSqrt().range([12, 40]).domain([1, 10]),
        nodeCache: new Map(),
        simulation: null,
        nodes: [],
        alphaTimeoutId: null
    };

    const setStatus = (message, isError = false) => {
        statusLabel.textContent = message;
        statusLabel.classList.toggle("is-error", Boolean(isError));
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

    const formatPeakPlayers = (value) => `${integerFormatter.format(Math.round(value || 0))} peak players`;
    const formatCompactPlayers = (value) => `${compactNumberFormatter.format(value || 0)} players`;

    const syncControls = () => {
        clearButton.disabled = !state.selectedGenres.length;
        topCountSelect.value = String(state.topN);
    };

    const renderGenreChips = () => {
        if (!state.availableGenres.length) {
            genreChipContainer.innerHTML = `
                <p class="compare-empty-note">Genre filters will appear once the Steam metadata loads.</p>
            `;
            return;
        }

        const selectedSet = new Set(state.selectedGenres);
        const selectionLocked = state.selectedGenres.length >= MAX_SELECTED_GENRES;

        genreChipContainer.innerHTML = state.availableGenres
            .map((genre) => {
                const stats = state.genreStats.get(genre) || { count: 0 };
                const isActive = selectedSet.has(genre);
                const isDisabled = selectionLocked && !isActive;

                return `
                    <button
                        class="cluster-chip ${isActive ? "is-active" : ""}"
                        type="button"
                        data-genre="${escapeHtml(genre)}"
                        aria-pressed="${isActive ? "true" : "false"}"
                        ${isDisabled ? "disabled" : ""}
                    >
                        <span>${escapeHtml(genre)}</span>
                        <small>${escapeHtml(integerFormatter.format(stats.count))}</small>
                    </button>
                `;
            })
            .join("");
    };

    const renderLegend = (nodes) => {
        if (!nodes.length) {
            legend.innerHTML = "";
            return;
        }

        const values = nodes
            .map((node) => node.peakCCU)
            .filter((value) => Number.isFinite(value))
            .sort((left, right) => left - right);
        const sampleIndices = [0, Math.floor((values.length - 1) / 2), values.length - 1];
        const seenValues = new Set();
        const sizeSamples = sampleIndices
            .map((index) => values[index])
            .filter((value) => {
                if (!Number.isFinite(value) || seenValues.has(value)) {
                    return false;
                }
                seenValues.add(value);
                return true;
            })
            .map((value) => ({
                value,
                diameter: Math.round(state.radiusScale(value) * 2)
            }));

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
                    ${sizeSamples
                        .map(
                            (sample) => `
                                <span class="cluster-legend__size-item">
                                    <span class="cluster-legend__size-circle" style="--size:${sample.diameter}px"></span>
                                    <span>${escapeHtml(formatCompactPlayers(sample.value))}</span>
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
            node.y = clamp(node.y, bounds.top + node.radius, bounds.bottom - node.radius);
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
            <span>${escapeHtml(formatPeakPlayers(node.peakCCU))}</span>
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

    const buildVisibleGames = () => {
        if (!state.selectedGenres.length) {
            return { matchedGames: [], displayedGames: [] };
        }

        const selectedSet = new Set(state.selectedGenres);
        const matchedGames = [];
        const seenAppIds = new Set();

        state.catalog.forEach((game) => {
            const matchedGenres = game.genres.filter((genre) => selectedSet.has(genre));
            if (!matchedGenres.length || seenAppIds.has(game.appId)) {
                return;
            }

            seenAppIds.add(game.appId);
            matchedGames.push({
                ...game,
                matchedGenres
            });
        });

        matchedGames.sort((left, right) => right.peakCCU - left.peakCCU || left.name.localeCompare(right.name));

        return {
            matchedGames,
            displayedGames: matchedGames.slice(0, state.topN)
        };
    };

    const buildNodes = (games, attractors) => {
        const attractorByGenre = new Map(attractors.map((attractor) => [attractor.genre, attractor]));

        return games.map((game) => {
            const cachedNode = state.nodeCache.get(game.appId);
            const targetPoints = game.matchedGenres
                .map((genre) => attractorByGenre.get(genre))
                .filter(Boolean);
            const centroid = targetPoints.reduce(
                (accumulator, point) => ({
                    x: accumulator.x + point.x,
                    y: accumulator.y + point.y
                }),
                { x: 0, y: 0 }
            );
            const targetX = centroid.x / Math.max(targetPoints.length, 1);
            const targetY = centroid.y / Math.max(targetPoints.length, 1);
            const radius = state.radiusScale(Math.max(1, game.peakCCU));
            const node = cachedNode || {
                appId: game.appId,
                x: targetX + (Math.random() - 0.5) * 40,
                y: -90 - Math.random() * 120,
                vx: 0,
                vy: 0
            };

            Object.assign(node, {
                ...game,
                radius,
                targetX,
                targetY
            });

            state.nodeCache.set(game.appId, node);
            return node;
        });
    };

    const updateScene = () => {
        syncControls();
        renderGenreChips();
        hideTooltip();

        if (!state.selectedGenres.length) {
            renderAttractors([]);
            renderLegend([]);
            renderBubbles([]);
            stopSimulation();
            setEmptyState("Pick 1-4 genres to create attractor zones.");
            setStatus("Choose at least one genre to spin up the gravity field.");
            return;
        }

        const attractors = getAttractorCoordinates(state.selectedGenres);
        renderAttractors(attractors);

        const { matchedGames, displayedGames } = buildVisibleGames();
        if (!matchedGames.length) {
            renderLegend([]);
            renderBubbles([]);
            stopSimulation();
            setEmptyState("No tracked titles matched those genre filters. Try a broader combination.");
            setStatus("No games matched the current genre combination.", true);
            return;
        }

        hideEmptyState();

        state.nodes = buildNodes(displayedGames, attractors);
        renderLegend(state.nodes);
        renderBubbles(state.nodes);
        updateBubblePositions();
        restartSimulation();

        const selectedLabel = state.selectedGenres.join(", ");
        const displayedCount = displayedGames.length;
        const hasOverflow = matchedGames.length > displayedCount;
        const countMessage = hasOverflow
            ? `Showing ${displayedCount} of ${matchedGames.length} matched titles.`
            : `Showing all ${displayedCount} matched titles.`;

        setStatus(`${countMessage} Active genres: ${selectedLabel}.`);
    };

    genreChipContainer.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-genre]");
        if (!button) {
            return;
        }

        const genre = button.dataset.genre;
        if (!genre) {
            return;
        }

        if (state.selectedGenres.includes(genre)) {
            state.selectedGenres = state.selectedGenres.filter((entry) => entry !== genre);
        } else if (state.selectedGenres.length < MAX_SELECTED_GENRES) {
            state.selectedGenres = [...state.selectedGenres, genre];
        }

        updateScene();
    });

    topCountSelect.addEventListener("change", () => {
        const nextValue = Number(topCountSelect.value) || 15;
        state.topN = clamp(nextValue, 10, 20);
        updateScene();
    });

    clearButton.addEventListener("click", () => {
        state.selectedGenres = [];
        updateScene();
    });

    telemetryPromise
        .then(() => {
            if (!dataStore.ready) {
                setStatus("Cluster data could not be loaded.", true);
                setEmptyState("Steam telemetry is unavailable for the cluster view.");
                return;
            }

            const catalog = dataStore.rankedAppIds
                .map((appId) => dataStore.metadata.get(appId))
                .filter(Boolean)
                .map((meta) => ({
                    appId: meta.appId,
                    name: meta.name,
                    peakCCU: Number(meta.peakCCU) || 0,
                    genres: splitCommaList(meta.genres),
                    companyType: getCompanyType(meta),
                    studioSize: meta.studioSize || getCompanyType(meta)
                }))
                .filter((entry) => entry.genres.length);

            const genreStats = new Map();
            catalog.forEach((game) => {
                game.genres.forEach((genre) => {
                    if (!genreStats.has(genre)) {
                        genreStats.set(genre, {
                            count: 0,
                            totalPeak: 0
                        });
                    }

                    const stats = genreStats.get(genre);
                    stats.count += 1;
                    stats.totalPeak += game.peakCCU;
                });
            });

            const [minPeak = 1, maxPeak = 10] = extent(catalog, (entry) => entry.peakCCU);
            state.catalog = catalog;
            state.genreStats = genreStats;
            state.availableGenres = Array.from(genreStats.entries())
                .sort(
                    (left, right) =>
                        right[1].count - left[1].count ||
                        right[1].totalPeak - left[1].totalPeak ||
                        left[0].localeCompare(right[0])
                )
                .map(([genre]) => genre);
            state.radiusScale.domain([
                Math.max(1, minPeak || 1),
                Math.max(Math.max(1, minPeak || 1) + 1, maxPeak || 10)
            ]);

            updateScene();
        })
        .catch((error) => {
            console.error("Cluster telemetry failed to load", error);
            setStatus("Failed to load cluster telemetry.", true);
            setEmptyState("The cluster view could not load the Steam metadata.");
        });
}
