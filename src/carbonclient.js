const carbonclient = {};

carbonclient.formatDate = time => Math.floor(time / 1000);

carbonclient.formatTarget = t => {
  if (typeof(t) === "string") {
    return encodeURIComponent(t);
  }

  let targetstr = encodeURIComponent(t.name);

  if (t.alias) {
    targetstr = `alias(${targetstr},'${t.alias}')`;
  }

  return targetstr;
};

carbonclient.fetch = (apiRoot, target, start, stop, config = {}) => {
  let query = ['format=json'];

  if (!Array.isArray(target)) {
    target = [target];
  }

  target.forEach(t => query.push(`target=${t}`));
  query.push(`from=${carbonclient.formatDate(start)}`);
  query.push(`until=${carbonclient.formatDate(stop || +(new Date()))}`);

  return fetch(apiRoot + '/render', {
    method: 'POST',
    mode: 'cors',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: query.join('&')
  }).then(r => r.json());
};

class CarbonMetric {
  constructor(name, alias, config = {}) {
    this.name = name;
    this.alias = alias;
    this.data = null;
  }

  toString() {
    return carbonclient.formatTarget(this);
  }

  update(data) {
    console.log("TODO update", this, data);
    this.data = data;
  }

  parse(data) {
    console.log("TODO parse", this, data);
    return data;
  }
}

class CarbonAPI {
  constructor(apiRoot, metrics = []) {
    this.apiRoot = apiRoot;
    this.metrics = metrics || [];
    this.period = 60; // 1 min
    this.timeframe = 60 * 60 * 24; // 1 day
    this.updateCallback = null;

    this._updating = null;
  }

  fetch(start, stop, config = {}) {
    return carbonclient.fetch(this.apiRoot, this.metrics, start, stop, config);
  }

  process(raw) {
    const data = {};

    raw.forEach(d => {
      if (d.target) {
        data[d.target] = d.datapoints;
      }
      if (d.tags && d.tags.name && !data[d.tags.name]) {
        data[d.tags.name] = d.datapoints;
      }
    });

    this.metrics.forEach(metric => {
      const metricData = data[metric.alias || metric.name || ''+metric];

      if (metricData && metric.update) {
        try {
          const d = metric.parse ? metric.parse(metricData) : metricData;
          metric.update(d);
        } catch(e) {
          console.warning("Error updating metric: " + metric, e);
        }
      }
    });
  }

  async _update() {
    const now = +(new Date());
    // TODO fetch delta + combine
    const data = await this.fetch(now - this.timeframe * 1000, now);
    this.process(data);

    if (this.updateCallback) {
      try {
        this.updateCallback(data);
      } catch (e) {
        console.error(e);
      }
    }

    this._updating = setTimeout(this._update.bind(this), this.period * 1000);
  }

  startPeriodicUpdate(timeframe, period, callback) {
    if (this._updating) {
      throw "Periodic update already running!";
    }
    this.timeframe = timeframe;
    this.period = period;
    this.updateCallback = callback;
    this._update();
  }

  stopPeriodicUpdate() {
    clearTimeout(this._updating);
    this.updateCallback = null;
    this._updating = null;
  }

}

// DEBUG
carbonclient.CarbonMetric = CarbonMetric;
carbonclient.CarbonAPI = CarbonAPI;
try {
  window.carbonclient = carbonclient;
} catch (e) {}

export {
  carbonclient,
  CarbonMetric,
  CarbonAPI
}
