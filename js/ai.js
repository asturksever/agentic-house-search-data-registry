// Optional AI summary. Filled in by the AI-summary milestone; the report is
// complete and readable without it, so this module never blocks a render.

export function resetAI(mount) {
  mount.innerHTML = '';
}

export function mountAI(mount, place, results) {
  void place; void results;
  mount.innerHTML = '';
}
