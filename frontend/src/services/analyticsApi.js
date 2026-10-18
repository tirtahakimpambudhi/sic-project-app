import api from "./api.js";

function buildParams(filters, extra = {}) {
  const p = new URLSearchParams();
  if (filters.start) p.set("start", filters.start);
  if (filters.end) p.set("end", filters.end);
  if (filters.device && filters.device.length > 0) {
    if (Array.isArray(filters.device)) {
      filters.device.forEach((d) => p.append("device", d));
    } else {
      p.set("device", filters.device);
    }
  }
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      p.set(k, v);
    }
  });
  return p;
}

export const analyticsApi = {
  getSummary: (filters) =>
    api.get("/analytics/summary/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsDaily: (filters) =>
    api.get("/analytics/alerts/daily/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsHourly: (filters) =>
    api.get("/analytics/alerts/hourly/", { params: buildParams(filters) }).then((r) => r.data),

  getRecentAlerts: (deviceFilter = []) => {
    const params = new URLSearchParams();
    if (Array.isArray(deviceFilter) && deviceFilter.length === 1) {
      params.set("device", deviceFilter[0]);
    } else if (typeof deviceFilter === "string" && deviceFilter) {
      params.set("device", deviceFilter);
    }
    return api.get("/alerts/", { params }).then((r) => {
      let data = Array.isArray(r.data) ? r.data : r.data.results || [];
      if (Array.isArray(deviceFilter) && deviceFilter.length > 1) {
        data = data.filter((item) => deviceFilter.includes(item.device_id));
      }
      return data.slice(0, 50);
    });
  },

  getAlertsByLocation: (filters) =>
    api.get("/analytics/alerts/by-location/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsHeatmap: (filters) =>
    api.get("/analytics/alerts/heatmap/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsByUnit: (filters) =>
    api.get("/analytics/alerts/by-unit/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsByType: (filters) =>
    api.get("/analytics/alerts/by-type/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsDuration: (filters) =>
    api.get("/analytics/alerts/duration/", { params: buildParams(filters) }).then((r) => r.data),

  getAlertsTable: (filters, { page = 1, pageSize = 50, status = "semua" } = {}) =>
    api
      .get("/analytics/alerts/table/", {
        params: buildParams(filters, { page, page_size: pageSize, status }),
      })
      .then((r) => r.data),

  downloadAlertsCsv: (filters, status = "semua") =>
    api
      .get("/analytics/alerts/table/", {
        params: buildParams(filters, { format: "csv", status }),
        responseType: "blob",
      })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data], { type: "text/csv" }));
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `alert_${filters.start}_sd_${filters.end}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }),

  getTelemetryByLocation: (filters) =>
    api.get("/analytics/telemetry/by-location/", { params: buildParams(filters) }).then((r) => r.data),

  getTelemetryCoverage: (filters) =>
    api.get("/analytics/telemetry/coverage/", { params: buildParams(filters) }).then((r) => r.data),

  getTelemetryStateMix: (filters) =>
    api.get("/analytics/telemetry/state-mix/", { params: buildParams(filters) }).then((r) => r.data),

  getTelemetryDistance: (filters, { device, unitId = 0 } = {}) =>
    api
      .get("/analytics/telemetry/distance/", {
        params: buildParams(filters, { device, unit_id: unitId }),
      })
      .then((r) => r.data),

  getTelemetryGaps: (filters) =>
    api.get("/analytics/telemetry/gaps/", { params: buildParams(filters) }).then((r) => r.data),
};

export default analyticsApi;
