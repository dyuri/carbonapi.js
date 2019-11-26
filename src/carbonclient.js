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

carbonclient.interpolate = (data, count=100) => {
  const linearInterpolate = (before, after, atPoint) => before + (after - before) * atPoint;

  const newData = [];
  const step = (data.length - 1) / (count - 1);
  
  newData[0] = data[0];

  for (let i = 1; i < count - 1; i++) {
    var tmp = i * step;
    var before = Math.floor(tmp);
    var after = Math.ceil(tmp);
    var atPoint = tmp - before;
    newData[i] = [
      linearInterpolate(data[before][0], data[after][0], atPoint),
      linearInterpolate(data[before][1], data[after][1], atPoint)
    ];
  }
  newData[count - 1] = data[data.length - 1];
  return newData;
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

  get length() {
    return this.data.length;
  }

  get precision() {
    if (this.data.length > 1) {
      return this.data[1][1] - this.data[0][1];
    }
    return 0;
  }

  toLength(len) {
    return carbonclient.interpolate(this.data, len);
  }

  update(data, replace=false) {
    if (this.data && !replace) {
      const len = this.data.length;
      const tmpdata = this.data.filter(d => d[0]);
      const lastts = tmpdata[tmpdata.length-1][1];
      const newdata = data.filter(d => d[1] > lastts && d[0]);
      if (newdata.length) {
        this.data = tmpdata.concat(newdata).slice(-len);
      }
    } else {
      this.data = data;
    }
  }

  parse(data) {
    return data;
  }
}

class CarbonAPI {
  constructor(apiRoot, metrics = []) {
    this.apiRoot = apiRoot;
    this.metrics = metrics || [];
    this.period = 0;
    this.timeframe = 60 * 60 * 24; // 1 day
    this.updateCallback = null;

    this._updating = null;
    this._lastupdated = 0;
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
          console.warn("Error updating metric: " + metric, e);
        }
      }
    });
  }

  async _update(full=false) {
    const now = +(new Date());
    let delta = false;
    if (this._lastupdated && !full) {
      delta = true;
    }
    
    const start = delta ?
      this._lastupdated - 2 * this.period * 1000 : // start 2 * period earlier for safety
      now - this.timeframe * 1000;

    const stop = now;
    const data = await this.fetch(start, stop);
    this.process(data, !delta);

    if (this.updateCallback) {
      try {
        this.updateCallback(data);
      } catch (e) {
        console.error(e);
      }
    }

    if (this.period) {
      this._updating = setTimeout(this._update.bind(this), this.period * 1000);
    }
    this._lastupdated = now;
  }

  startPeriodicUpdate(timeframe, period=60, callback=null) {
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
    this.period = null;
    this._updating = null;
    this._lastupdated = null;
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
