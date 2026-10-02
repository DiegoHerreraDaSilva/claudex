export function visibleEvents(events) {
  return events.filter((event, index) => {
    if (event.kind !== "assistant") return true;

    for (let i = index + 1; i < events.length; i++) {
      if (events[i].kind === "user") break;

      if (events[i].kind === "result" && events[i].text.trim() === event.text.trim()) return false;
    }

    return true;
  });
}
