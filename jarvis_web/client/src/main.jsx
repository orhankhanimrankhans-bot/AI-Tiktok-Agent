import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TikTokUpload from './TikTokUpload.jsx'
import FacebookTikTokCrosspost from './FacebookTikTokCrosspost.jsx'
import PrivacyPolicy from './PrivacyPolicy.jsx'
import TermsOfService from './TermsOfService.jsx'
import DataDeletion from './DataDeletion.jsx'
import { resolvePublicPage } from './publicRoutes.js'
import { JarvisAuthGate, useJarvisAuth } from './JarvisAuth.jsx'
import build from '../../shared/buildVersion.json'

function WorkspaceApp() {
  const { session } = useJarvisAuth();
  if (window.location.pathname.replace(/\/+$/, "") === "/tiktok/crosspost") return <FacebookTikTokCrosspost key={session?.workspaceId || "unauthenticated"} />;
  if (window.location.pathname.replace(/\/+$/, "") === "/tiktok") return <TikTokUpload key={session?.workspaceId || "unauthenticated"} />;
  return <App key={session?.workspaceId || "unauthenticated"} />;
}

const publicPage = resolvePublicPage(window.location.pathname)
const RootComponent = publicPage === 'privacy-policy'
  ? PrivacyPolicy
  : publicPage === 'terms'
    ? TermsOfService
    : publicPage === 'data-deletion'
      ? DataDeletion
      : () => <JarvisAuthGate><WorkspaceApp /></JarvisAuthGate>

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootComponent />
    {!publicPage && <small aria-label="COREX build version" style={{ position: 'fixed', bottom: 4, right: 8, zIndex: 10000, padding: '3px 7px', borderRadius: 4, background: '#111827', color: '#e5e7eb', fontSize: 10, pointerEvents: 'none' }}>COREX · Build: {build.version}</small>}
  </StrictMode>,
)
