class TaskContext {
  constructor() {
    this.actions = [];
    this.request = '';
    this.browser = null;
    this.updated = 0;
  }
  record(action, result) {
    const args = { ...action.args };
    for (const key of ['text', 'content', 'command'])
      if (Object.hasOwn(args, key)) args[key] = '[private input omitted]';
    this.actions.push({
      tool: action.tool,
      args,
      attempted: true,
      verified: result.verified === true,
      success: result.success !== false,
      observed_result: result.observed_result
        ? {
            title: result.observed_result.title || result.observed_result.activeWindow?.title,
            application:
              result.observed_result.application ||
              result.observed_result.activeWindow?.application,
            url: result.observed_result.url,
            screenChanged: result.observed_result.screenChanged,
            windows: result.observed_result.windows?.map((w) => ({
              title: w.title,
              url: w.url,
              foreground: w.foreground,
            })),
          }
        : null,
      message: result.message,
      time: Date.now(),
    });
    this.actions = this.actions.slice(-12);
    this.updated = Date.now();
    if (
      ['open_url', 'search_web', 'browser_control', 'browser_state'].includes(action.tool) &&
      result.verified
    )
      this.browser = result.observed_result;
  }
  snapshot() {
    return {
      request: this.request.slice(0, 500),
      recentActions: this.actions.filter((a) => Date.now() - a.time < 300000).slice(-5),
      browser: Date.now() - this.updated < 120000 ? this.browser : null,
    };
  }
}
module.exports = { TaskContext };
