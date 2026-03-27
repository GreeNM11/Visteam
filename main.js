import { initTrendModule } from "./trend_view.js";
import { initCompareModule } from "./compare_view.js";

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
const getIndexForDate = (date) =>
    clamp(daysBetween(dataStore.dateRange.start, date), 0, dataStore.fullTimeline.length - 1);
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
    const fetchFirstAvailableCsv = async (relativePaths) => {
        for (const relativePath of relativePaths) {
            const url = new URL(relativePath, import.meta.url).href;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    return response;
                }
            } catch (error) {
                console.warn(`CSV fetch failed for ${url}`, error);
            }
        }

        throw new Error(`Failed to fetch telemetry CSV from paths: ${relativePaths.join(", ")}`);
    };

    const [topResponse, dailyResponse] = await Promise.all([
        fetchFirstAvailableCsv(["./data/top500.csv", "./data/nonsteamdb_csvs/top500.csv"]),
        fetchFirstAvailableCsv([
            "./data/daily_peaks_top500.csv",
            "./data/nonsteamdb_csvs/daily_peaks_top500.csv"
        ])
    ]);

    const [topText, dailyText] = await Promise.all([topResponse.text(), dailyResponse.text()]);
    const metadataResult = hydrateMetadata(topText);
    const dailyResult = hydrateDailySeries(dailyText);

    dataStore.metadata = metadataResult.metaMap;
    dataStore.seriesById = dailyResult.seriesById;
    dataStore.dateRange = dailyResult.dateRange;
    dataStore.rankedAppIds = metadataResult.rankedAppIds.filter((appId) => dataStore.seriesById.has(appId));
    dataStore.fullTimeline = dataStore.dateRange ? buildTimeline(dataStore.dateRange.start, dataStore.dateRange.end) : [];
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

const setupNavigation = () => {
    const navLinks = document.querySelectorAll(".rail nav a[data-view]");
    const blankState = document.querySelector(".canvas__blank");
    const canvasPanels = document.querySelectorAll(".canvas__content[data-view]");
    const signalBand = document.querySelector(".signal-band");
    const workspace = document.querySelector(".workspace");

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
            if (signalBand) {
                signalBand.hidden = Boolean(matchedPanel);
                signalBand.style.display = matchedPanel ? "none" : "";
            }
            if (workspace) {
                workspace.classList.toggle("is-focus-view", Boolean(matchedPanel));
            }
        });
    });
};

const createSharedContext = () => ({
    dataStore,
    telemetryPromise,
    constants: {
        COLOR_PALETTE,
        TREND_FRAME_INTERVAL,
        COMPARE_MIN_SELECTION,
        COMPARE_MAX_SELECTION,
        MIN_WINDOW_POINTS
    },
    utils: {
        clamp,
        escapeHtml,
        padNumber,
        createCalendarDate,
        cloneCalendarDate,
        addDays,
        getUtcDayValue,
        daysBetween,
        toDateKey,
        formatAxisNumber,
        formatMetricValue,
        formatRawChange,
        formatIndexedChange,
        formatPercentChange,
        getCompanyLabel,
        parseCSVRows,
        normalizeScope,
        hydrateMetadata,
        hydrateDailySeries,
        buildTimeline,
        parseDateInput,
        clampToDataDomain,
        getIndexForDate,
        getRelativeCanvasPoint,
        isPointInPlot,
        pixelToIndex,
        drawCanvasPlaceholder,
        shortDateFormatter,
        longDateFormatter,
        integerFormatter,
        decimalFormatter,
        compactNumberFormatter,
        percentFormatter
    }
});

document.addEventListener("DOMContentLoaded", () => {
    setupNavigation();
    const context = createSharedContext();
    initTrendModule(context);
    initCompareModule(context);
});
