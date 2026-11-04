async function* eventsToSSE(events, options = {}) {
  const includeDone = options.includeDone !== false;

  for await (const event of events) {
    if (!event || typeof event !== "object") {
      continue;
    }
    const payload = JSON.stringify(event);
    yield `event: ${event.type}\n`;
    yield `data: ${payload}\n\n`;
  }

  if (includeDone) {
    yield "data: [DONE]\n\n";
  }
}

module.exports = {
  eventsToSSE,
};
