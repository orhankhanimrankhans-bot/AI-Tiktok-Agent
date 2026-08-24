import { useEffect, useMemo, useState } from "react";
import officeScene from "./assets/jarvis-ai-office.webp";
import atlasPoses from "./assets/employees/atlas-poses.webp";
import imranPoses from "./assets/employees/imran-poses.webp";
import kazimPoses from "./assets/employees/kazim-poses.webp";
import linkPoses from "./assets/employees/link-poses.webp";
import novaPoses from "./assets/employees/nova-poses.webp";
import orbitPoses from "./assets/employees/orbit-poses.webp";
import pulsePoses from "./assets/employees/pulse-poses.webp";
import sulaimanPoses from "./assets/employees/sulaiman-poses.webp";
import { findOfficeRoute, interpolateRoutePosition, routeDistance, routePath } from "./officeMovement.js";

const AGENTS = [
  { id: "nova", name: "NOVA", role: "Communication", capabilities: "WhatsApp / chat / messages", x: 18.5, y: 43.5, accent: "#61e5ff" },
  { id: "pulse", name: "PULSE", role: "Social Analytics", capabilities: "TikTok / YouTube / Facebook", x: 37, y: 43.5, accent: "#b776ff" },
  { id: "orbit", name: "ORBIT", role: "Workflow & Automation", capabilities: "Runs / routing / errors", x: 16.5, y: 69.5, accent: "#58f0b4" },
  { id: "atlas", name: "ATLAS", role: "System & Resources", capabilities: "Health / files / storage", x: 36, y: 69.5, accent: "#ffbd59" },
  { id: "link", name: "LINK", role: "Office Coordinator", capabilities: "Agents / members / transfers", x: 72.5, y: 32, accent: "#73a7ff" },
];
const MEMBERS = [
  { id: "imran", name: "IMRAN", role: "Owner workspace", services: "Main Access", x: 59, y: 69.5, accent: "#62d4ff" },
  { id: "sulaiman", name: "SULAIMAN", role: "Team workspace", services: "Resources ready", x: 74, y: 69.5, accent: "#8ee38b" },
  { id: "kazim", name: "KAZIM", role: "Team workspace", services: "Drive / files ready for connection", x: 90, y: 69.5, accent: "#f5a76f" },
];
const LOCATIONS = [{ id: "amazon", name: "AMAZON OPERATIONS", role: "Commerce operations room", services: "Amazon integration", x: 87, y: 31 }];
const EMPLOYEE_POSES = { atlas: atlasPoses, imran: imranPoses, kazim: kazimPoses, link: linkPoses, nova: novaPoses, orbit: orbitPoses, pulse: pulsePoses, sulaiman: sulaimanPoses };
const ROOM_BOUNDS = [
  { id: "main", label: "MAIN ACCESS ROOM", x: 3, y: 7, width: 49, height: 76 },
  { id: "coordinator", label: "COORDINATOR ROOM", x: 64, y: 7, width: 15.5, height: 38 },
  { id: "amazon", label: "AMAZON OPERATIONS", x: 80, y: 7, width: 17, height: 38 },
  { id: "human", label: "HUMAN WORKSPACES", x: 53, y: 47, width: 44, height: 36 },
];
const LINK_ROUTES = {
  imran: "M780 163 C720 220 675 290 590 388",
  sulaiman: "M780 163 C760 230 745 305 740 388",
  kazim: "M780 163 C835 225 870 300 900 388",
  main: "M780 163 C650 205 535 250 355 310",
};

function statusClass(status) { return String(status || "AVAILABLE").toLowerCase().replaceAll("_", "-"); }

function OfficeHotspot({ item, status, task, active = false, away = false, onSelect }) {
  const state = statusClass(status);
  return <button type="button" className={`office-hotspot hotspot-${item.id} state-${state}${active ? " hotspot-active" : ""}${away ? " hotspot-away" : ""}`} style={{ "--office-x": `${item.x}%`, "--office-y": `${item.y}%` }} onClick={() => onSelect({ type: item.services ? "workspace" : "agent", ...item, status, task })} aria-label={`${item.name}, ${status}`}>
    <span className="hotspot-monitor-glow" /><span className="hotspot-ring"><i /></span><span className="hotspot-label"><strong>{item.name}</strong><small>{status}</small></span>
  </button>;
}

function RoomHighlight({ room, active }) {
  return <span className={`office-room-overlay room-overlay-${room.id}${active ? " room-overlay-active" : ""}`} style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.width}%`, height: `${room.height}%` }}><b>{room.label}</b></span>;
}

function OfficeDetail({ selected, onClose }) {
  if (!selected) return null;
  return <aside className="office-detail-popover" aria-live="polite"><button type="button" onClick={onClose} aria-label="Close office detail">X</button><span>{selected.type === "agent" ? "AI EMPLOYEE" : selected.type === "platform" ? "PLATFORM STATUS" : "AUTHORIZED WORKSPACE"}</span><h3>{selected.name}</h3><strong>{selected.status}</strong><p>{selected.role}</p><small>{selected.task?.title || selected.capabilities || selected.services}</small></aside>;
}

function PlatformSign({ id, name, status, x, y, onSelect, onNavigate }) {
  const connected = status === "CONNECTED";
  const open = () => { if (id !== "amazon" && onNavigate) onNavigate(id); else onSelect({ type: "platform", id, name, status, role: id === "amazon" ? "Amazon Operations" : "Social Operations", services: connected ? "Connected application state" : `${name} is not connected.` }); };
  return <button type="button" className={`platform-sign platform-${id} ${connected ? "is-connected" : "is-disconnected"}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={open} aria-label={`${name}, ${status}`}><span className="platform-a11y">{name}: {status}</span></button>;
}

function packageGlyph(type) { return { video: "V", file: "F", workflow: "W", message: "M", task: "T" }[type] || "T"; }

function OfficeEmployee({ item, status, pose = "seated", position = item, packageType = null, phase = "", facing = "right", onSelect }) {
  const human = Boolean(item.services);
  const movementPose = phase === "HANDING_OVER" ? "handover" : ["WALKING_TO_DESTINATION", "RETURNING"].includes(phase) ? "walking" : phase === "ARRIVED" ? "carrying" : pose;
  const movementLabel = ["WALKING_TO_DESTINATION", "ARRIVED", "HANDING_OVER"].includes(phase) ? "DELIVERING" : phase === "RETURNING" ? "RETURNING" : null;
  const identityStatus = movementLabel || String(status || "AVAILABLE").replaceAll("_", " ");
  return <button type="button" className={`office-character character-${human ? "human" : "agent"} pose-${movementPose} facing-${facing} employee-${item.id} ${phase ? `phase-${phase.toLowerCase().replaceAll("_", "-")}` : ""}`} style={{ left: `${position.x}%`, top: `${position.y}%`, "--character-accent": item.accent, "--employee-sheet": `url(${EMPLOYEE_POSES[item.id]})` }} onClick={() => onSelect({ type: human ? "workspace" : "agent", ...item, status })} aria-label={`${item.name}, ${status}`}>
    <span className="employee-sprite" aria-hidden="true" />
    {packageType && <span className={`work-package package-${packageType}`}>{packageGlyph(packageType)}</span>}
    <span className="employee-identity"><strong>{item.name}</strong><small>{identityStatus}</small></span>
  </button>;
}

function MovingOfficeAgent({ handoff, phase, position, source, destination, onSelect }) {
  const outboundRight = destination.x >= source.x;
  const seated = phase === "STANDING_UP" || phase === "SEATED";
  const carrying = !["RETURNING", "RETURNED", "SEATED"].includes(phase);
  return <OfficeEmployee item={source} status={phase} pose={seated ? "seated" : "standing"} position={position} packageType={carrying ? handoff.packageType : null} phase={phase} facing={(phase === "RETURNING" ? !outboundRight : outboundRight) ? "right" : "left"} onSelect={() => onSelect({ type: "agent", ...source, status: phase, task: { title: handoff.title }, capabilities: `Destination: ${destination.name}` })} />;
}

function HandoffMovement({ handoff, route, source, destination, onSelect, onComplete, onPhase }) {
  const [phase, setPhase] = useState("STANDING_UP");
  const [position, setPosition] = useState(route[0]);
  const outboundPath = useMemo(() => routePath(route), [route]);
  const returnPath = useMemo(() => routePath(route, true), [route]);
  useEffect(() => {
    if (phase === "SEATED") return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = { STANDING_UP: "STANDING", STANDING: "WALKING_TO_DESTINATION", WALKING_TO_DESTINATION: "ARRIVED", ARRIVED: "HANDING_OVER", HANDING_OVER: "RETURNING", RETURNING: "RETURNED", RETURNED: "SEATED" }[phase];
    const walking = phase === "WALKING_TO_DESTINATION" || phase === "RETURNING";
    const standingUp = phase === "STANDING_UP";
    const sittingDown = phase === "RETURNED";
    const duration = reduced ? 100 : walking ? Math.max(3000, Math.min(4000, routeDistance(route) * 58)) : { STANDING_UP: 800, STANDING: 350, ARRIVED: 400, HANDING_OVER: 1300, RETURNED: 650 }[phase];
    onPhase?.(phase);
    if (walking || standingUp || sittingDown) {
      const activeRoute = standingUp ? route.slice(0, 2) : sittingDown ? route.slice(0, 2).reverse() : phase === "RETURNING" ? [...route].reverse().slice(0, -1) : route.slice(1);
      let frame, started;
      const step = (time) => {
        started ??= time;
        const progress = Math.min(1, (time - started) / duration);
        setPosition(interpolateRoutePosition(activeRoute, progress));
        if (progress < 1) frame = window.requestAnimationFrame(step);
        else setPhase(next);
      };
      frame = window.requestAnimationFrame(step);
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => setPhase(next), duration);
    return () => window.clearTimeout(timer);
  }, [handoff.id, onPhase, phase, route]);
  useEffect(() => {
    if (phase !== "SEATED") return;
    onPhase?.("SEATED");
    const timer = window.setTimeout(() => onComplete?.(handoff.id), 500);
    return () => window.clearTimeout(timer);
  }, [handoff.id, onComplete, onPhase, phase]);
  return <>{phase !== "SEATED" && <svg className="office-movement-layer" viewBox="0 0 1000 562" preserveAspectRatio="none" aria-hidden="true"><path className="movement-route" d={phase === "RETURNING" ? returnPath : outboundPath} /></svg>}<MovingOfficeAgent handoff={handoff} phase={phase} position={position} source={source} destination={destination} onSelect={onSelect} /></>;
}

export default function OfficeSimulation({ agentStates, activeWorkspace, tasks, handoff = null, onHandoffComplete, platformStates = {}, onPlatformSelect }) {
  const [selected, setSelected] = useState(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [movementPhase, setMovementPhase] = useState("STANDING_UP");
  const currentTask = (agentName) => [...tasks].reverse().find((task) => task.agent === agentName);
  const linkStatus = agentStates.link || "AVAILABLE";
  const linkWorking = linkStatus === "WORKING";
  const routeTarget = activeWorkspace && LINK_ROUTES[activeWorkspace] ? activeWorkspace : "main";
  const movementRoute = useMemo(() => handoff ? findOfficeRoute(handoff.source, handoff.destination) : [], [handoff]);
  const sourceItem = handoff ? [...AGENTS, ...MEMBERS].find((item) => item.id === handoff.source) : null;
  const destinationItem = handoff ? [...AGENTS, ...MEMBERS, ...LOCATIONS].find((item) => item.id === handoff.destination) : null;
  const movementActive = Boolean(handoff && sourceItem && destinationItem && movementRoute.length);
  const destinationStatus = (id, fallback) => {
    if (!movementActive || id !== handoff.destination) return fallback;
    if (["STANDING_UP", "STANDING", "WALKING_TO_DESTINATION"].includes(movementPhase)) return "AVAILABLE";
    if (["ARRIVED", "HANDING_OVER"].includes(movementPhase)) return handoff.outcome === "ERROR" ? "ERROR" : "RECEIVING";
    return fallback;
  };
  return <section className="ai-office office-simulation office-hybrid" aria-label="AI Office"><header><div><span>LIVE OPERATIONS FLOOR</span><h2>AI OFFICE</h2></div><small>{tasks.filter((task) => task.status === "WORKING").length} ACTIVE TASKS</small></header>
    <div className={`office-scene${imageFailed ? " office-scene-fallback" : ""}`}>
      {!imageFailed && <img className="office-scene-image" src={officeScene} alt="Dark futuristic Jarvis AI headquarters office" onError={() => setImageFailed(true)} />}
      {imageFailed && <div className="office-image-fallback"><strong>AI OFFICE</strong><span>Visual scene unavailable. Live controls remain active.</span></div>}
      <div className="office-scene-vignette" aria-hidden="true" />
      {ROOM_BOUNDS.map((room) => <RoomHighlight key={room.id} room={room} active={(room.id === "human" && ((linkWorking && Boolean(activeWorkspace)) || (movementActive && MEMBERS.some((member) => member.id === handoff.destination)))) || (room.id === "coordinator" && movementActive && handoff.destination === "link") || (room.id === "amazon" && (activeWorkspace === "amazon" || (movementActive && handoff.destination === "amazon")))} />)}
      <PlatformSign id="facebook" name="Facebook" status={platformStates.facebook || "NOT CONNECTED"} x={31} y={15} onSelect={setSelected} onNavigate={onPlatformSelect} />
      <PlatformSign id="tiktok" name="TikTok" status={platformStates.tiktok || "NOT CONNECTED"} x={38} y={15} onSelect={setSelected} onNavigate={onPlatformSelect} />
      <PlatformSign id="youtube" name="YouTube" status={platformStates.youtube || "NOT CONNECTED"} x={45} y={15} onSelect={setSelected} onNavigate={onPlatformSelect} />
      <PlatformSign id="amazon" name="Amazon" status={platformStates.amazon || "NOT CONNECTED"} x={87} y={12.5} onSelect={setSelected} />
      {[...AGENTS, ...MEMBERS].map((item) => movementActive && item.id === handoff.source ? null : <OfficeEmployee key={item.id} item={item} status={destinationStatus(item.id, item.services ? (linkWorking && activeWorkspace === item.id ? "WORKING" : "AVAILABLE") : agentStates[item.id] || "AVAILABLE")} pose="seated" onSelect={setSelected} />)}
      {AGENTS.map((agent) => <OfficeHotspot key={agent.id} item={agent} status={destinationStatus(agent.id, agentStates[agent.id] || "AVAILABLE")} task={currentTask(agent.name)} away={movementActive && agent.id === handoff.source} active={movementActive && agent.id === handoff.destination && ["ARRIVED", "HANDING_OVER"].includes(movementPhase)} onSelect={setSelected} />)}
      {MEMBERS.map((member) => <OfficeHotspot key={member.id} item={member} status={destinationStatus(member.id, linkWorking && activeWorkspace === member.id ? "WORKING" : "AVAILABLE")} away={movementActive && member.id === handoff.source} active={(linkWorking && activeWorkspace === member.id) || (movementActive && member.id === handoff.destination && ["ARRIVED", "HANDING_OVER"].includes(movementPhase))} onSelect={setSelected} />)}
      {LOCATIONS.map((location) => <OfficeHotspot key={location.id} item={location} status={destinationStatus(location.id, platformStates.amazon || "NOT CONNECTED")} active={movementActive && location.id === handoff.destination && ["ARRIVED", "HANDING_OVER"].includes(movementPhase)} onSelect={setSelected} />)}
      <svg className={`office-live-route${linkWorking ? " route-visible" : ""}`} viewBox="0 0 1000 562" preserveAspectRatio="none" aria-hidden="true"><path d={LINK_ROUTES[routeTarget]} /><circle cx="780" cy="163" r="5" /></svg>
      {linkWorking && <span className={`link-live-marker route-to-${routeTarget}`} aria-hidden="true">L</span>}
      {movementActive && <HandoffMovement key={handoff.id} handoff={handoff} route={movementRoute} source={sourceItem} destination={destinationItem} onSelect={setSelected} onComplete={onHandoffComplete} onPhase={setMovementPhase} />}
      <OfficeDetail selected={selected} onClose={() => setSelected(null)} />
    </div>
  </section>;
}
