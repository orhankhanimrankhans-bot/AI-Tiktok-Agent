export const OFFICE_POINTS = Object.freeze({
  nova: [18.5, 43.5], pulse: [37, 43.5], orbit: [16.5, 69.5], atlas: [36, 69.5], link: [72.5, 32],
  imran: [59, 69.5], sulaiman: [74, 69.5], kazim: [90, 69.5],
  amazon: [87, 31],
  novaStand: [21, 46], pulseStand: [39, 46], orbitStand: [19, 65], atlasStand: [39, 65], linkStand: [70, 35],
  imranStand: [59, 64], sulaimanStand: [74, 64], kazimStand: [90, 64],
  mainAisle: [47, 52], mainDoor: [55, 43], corridorTop: [60, 43], corridorJunction: [60, 51],
  coordinatorDoor: [67, 38], humanHall: [72, 51], imranDoor: [59, 55], sulaimanDoor: [74, 55], kazimDoor: [89, 55],
  amazonDoor: [80, 40], amazonApproach: [83, 37], amazonStanding: [86, 35], amazonHandover: [87, 32], amazonDesk: [87, 31],
});

const LINKS = Object.freeze({
  nova: ["novaStand"], novaStand: ["nova", "mainAisle"], pulse: ["pulseStand"], pulseStand: ["pulse", "mainAisle"],
  orbit: ["orbitStand"], orbitStand: ["orbit", "mainAisle"], atlas: ["atlasStand"], atlasStand: ["atlas", "mainAisle"],
  mainAisle: ["novaStand", "pulseStand", "orbitStand", "atlasStand", "mainDoor"],
  mainDoor: ["mainAisle", "corridorTop"], corridorTop: ["mainDoor", "corridorJunction", "coordinatorDoor", "amazonDoor"], coordinatorDoor: ["corridorTop", "linkStand"], linkStand: ["coordinatorDoor", "link"], link: ["linkStand"],
  amazonDoor: ["corridorTop", "amazonApproach"], amazonApproach: ["amazonDoor", "amazonStanding"], amazonStanding: ["amazonApproach", "amazonHandover"], amazonHandover: ["amazonStanding", "amazonDesk"], amazonDesk: ["amazonHandover", "amazon"], amazon: ["amazonDesk"],
  corridorJunction: ["corridorTop", "humanHall"], humanHall: ["corridorJunction", "imranDoor", "sulaimanDoor", "kazimDoor"],
  imranDoor: ["humanHall", "imranStand"], sulaimanDoor: ["humanHall", "sulaimanStand"], kazimDoor: ["humanHall", "kazimStand"],
  imranStand: ["imranDoor", "imran"], sulaimanStand: ["sulaimanDoor", "sulaiman"], kazimStand: ["kazimDoor", "kazim"],
  imran: ["imranStand"], sulaiman: ["sulaimanStand"], kazim: ["kazimStand"],
});

export function findOfficeRoute(source, destination) {
  if (!OFFICE_POINTS[source] || !OFFICE_POINTS[destination]) return [];
  const queue = [[source]], visited = new Set([source]);
  while (queue.length) {
    const route = queue.shift(), current = route.at(-1);
    if (current === destination) return route.map((id) => ({ id, x: OFFICE_POINTS[id][0], y: OFFICE_POINTS[id][1] }));
    for (const next of LINKS[current] || []) if (!visited.has(next)) { visited.add(next); queue.push([...route, next]); }
  }
  return [];
}

export function routePath(route, reverse = false) {
  const points = reverse ? [...route].reverse() : route;
  return points.map((point, index) => `${index ? "L" : "M"}${Number((point.x * 10).toFixed(2))} ${Number((point.y * 5.62).toFixed(2))}`).join(" ");
}

export function routeDistance(route) {
  return route.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - route[index].x, point.y - route[index].y), 0);
}

export function interpolateRoutePosition(route, progress) {
  if (!route.length) return null;
  if (route.length === 1) return route[0];
  if (progress <= 0) return { x: route[0].x, y: route[0].y };
  if (progress >= 1) return { x: route.at(-1).x, y: route.at(-1).y };
  const lengths = route.slice(1).map((point, index) => Math.hypot(point.x - route[index].x, point.y - route[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] ? remaining / lengths[index] : 0;
      return { x: route[index].x + (route[index + 1].x - route[index].x) * ratio, y: route[index].y + (route[index + 1].y - route[index].y) * ratio };
    }
    remaining -= lengths[index];
  }
  return route.at(-1);
}

export function handoffIntent(text) {
  const value = String(text || "").toLowerCase();
  if (!/\b(give|send|take|deliver|hand|bring|pass|transfer)\b/.test(value)) return null;
  const ids = ["nova", "pulse", "orbit", "atlas", "link", "imran", "sulaiman", "kazim", "amazon"]
    .map((id) => ({ id, index: value.indexOf(id) })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index).map((item) => item.id);
  if (ids.length < 2 && ids.length === 1 && /\b(to me|bring.*me)\b/.test(value)) ids.push("imran");
  if (ids.length < 2 || ids[0] === ids[1]) return null;
  const packageType = /video|media/.test(value) ? "video" : /file|document|paper/.test(value) ? "file" : /workflow|automation/.test(value) ? "workflow" : /message|chat/.test(value) ? "message" : "task";
  return { source: ids[0], destination: ids[1], packageType };
}
