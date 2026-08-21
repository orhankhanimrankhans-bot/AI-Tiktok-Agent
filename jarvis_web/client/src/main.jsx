import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PrivacyPolicy from './PrivacyPolicy.jsx'
import { resolvePublicPage } from './publicRoutes.js'

const publicPage = resolvePublicPage(window.location.pathname)
const RootComponent = publicPage === 'privacy-policy' ? PrivacyPolicy : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
