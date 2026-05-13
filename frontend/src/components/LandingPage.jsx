// Public-facing marketing landing page rendered at `/` when the user is not
// authenticated. Completely self-contained — all styles live in the inline
// <style> block below and use the `lp-*` class prefix so nothing here can
// leak into or be affected by the app's styles.css.
//
// The login flow itself is untouched: "Log In" links to /login. "Get
// Started" scrolls to the Contact section so prospective dealers can
// reach out before being asked to sign in.

import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <>
      <style>{LANDING_CSS}</style>
      <NavBar />
      <Hero />
      <Features />
      <HowItWorks />
      <ImageStrip />
      <About />
      <Contact />
      <Footer />
    </>
  );
}

// ============================================================
// Navigation
// ============================================================
function NavBar() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: '#features',     label: 'Features' },
    { href: '#how-it-works', label: 'How It Works' },
    { href: '#about',        label: 'About' },
    { href: '#contact',      label: 'Contact' },
  ];
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <a href="#top" className="lp-nav-brand" aria-label="BuildTek home">
          <img src="/buildtek-logo.svg?v=2" alt="BuildTek" height="32" />
        </a>
        <div className={`lp-nav-links ${open ? 'lp-nav-links-open' : ''}`}>
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="lp-nav-link">{l.label}</a>
          ))}
          <Link to="/login" className="lp-nav-cta" onClick={() => setOpen(false)}>Log In</Link>
        </div>
        <button
          type="button"
          className="lp-nav-burger"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </div>
    </nav>
  );
}

// ============================================================
// Hero
// ============================================================
function Hero() {
  return (
    <header id="top" className="lp-hero">
      <div className="lp-hero-grid" aria-hidden="true" />
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <span className="lp-pill">Built for Building Supply Dealers</span>
          <h1 className="lp-hero-title">
            Modernizing Building<br />Material Takeoffs
          </h1>
          <p className="lp-hero-sub">
            From floor plan sketch to professional material quote in minutes.
            Built specifically for lumber yards and building supply dealers.
          </p>
          <div className="lp-hero-ctas">
            <a href="#contact" className="lp-btn lp-btn-primary">Get Started</a>
            <Link to="/login" className="lp-btn lp-btn-outline">Log In</Link>
          </div>
          <div className="lp-hero-proof">Used by building supply dealers across Ontario</div>
        </div>
        <div className="lp-hero-art" aria-hidden="true">
          <FloorPlanSVG />
        </div>
      </div>
    </header>
  );
}

// Hand-coded mockup: an L-shaped wall polygon with overhang dashes,
// dimension labels, and a partial material list card floating in front.
function FloorPlanSVG() {
  return (
    <svg viewBox="0 0 540 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Floor plan sketch preview">
      <defs>
        <pattern id="lp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
        </pattern>
        <filter id="lp-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000" floodOpacity="0.35" />
        </filter>
      </defs>
      <rect width="540" height="440" fill="url(#lp-grid)" />
      {/* L-shaped wall polygon (outer). */}
      <polygon
        points="60,80 360,80 360,200 280,200 280,360 60,360"
        fill="rgba(37,99,235,0.10)"
        stroke="#2563EB"
        strokeWidth="2.5"
        strokeLinejoin="miter"
      />
      {/* Eave dashed inset to suggest the overhang. */}
      <polygon
        points="72,92 348,92 348,212 268,212 268,348 72,348"
        fill="none"
        stroke="#6B7280"
        strokeWidth="0.8"
        strokeDasharray="3 4"
      />
      {/* Overhang handle dots at midpoints of each edge. */}
      {[
        { x: 210, y: 64 },  { x: 376, y: 140 }, { x: 320, y: 184 },
        { x: 296, y: 280 }, { x: 170, y: 376 }, { x: 44, y: 220 },
      ].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="6" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" />
          <path d={`M ${p.x - 3} ${p.y} L ${p.x + 3} ${p.y}`} stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round" />
        </g>
      ))}
      {/* Wall corners. */}
      {[
        [60,80],[360,80],[360,200],[280,200],[280,360],[60,360],
      ].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="3.5" fill="#1D4ED8" />
      ))}
      {/* Dimension labels. */}
      <DimensionLabel x={210} y={48}  text="32.0'" />
      <DimensionLabel x={400} y={140} text="14.0'" />
      <DimensionLabel x={32}  y={220} text="30.0'" />
      <DimensionLabel x={172} y={394} text="24.0'" />
      {/* Section name + area badge in the polygon. */}
      <g transform="translate(150 200)">
        <rect x="-44" y="-14" width="100" height="28" rx="4" fill="rgba(255,255,255,0.92)" />
        <text x="6" y="-1" textAnchor="middle" fontFamily="system-ui" fontSize="11" fontWeight="700" fill="#1D4ED8">Main Floor</text>
        <text x="6" y="10" textAnchor="middle" fontFamily="system-ui" fontSize="9" fontWeight="500" fill="#6B7280">812 sf</text>
      </g>
      {/* Material list card overlay. */}
      <g transform="translate(296 244)" filter="url(#lp-shadow)">
        <rect x="0" y="0" width="220" height="170" rx="10" fill="#FFFFFF" stroke="#E5E7EB" />
        <rect x="0" y="0" width="220" height="32" rx="10" fill="#0A0A0A" />
        <rect x="0" y="22" width="220" height="10" fill="#0A0A0A" />
        <text x="14" y="20" fontFamily="system-ui" fontSize="11" fontWeight="700" fill="#FFFFFF">Material List</text>
        <text x="206" y="20" textAnchor="end" fontFamily="system-ui" fontSize="10" fontWeight="500" fill="#FFB800">37 items</text>
        {/* Section band row. */}
        <rect x="0" y="40" width="220" height="18" fill="#CC0000" />
        <text x="14" y="53" fontFamily="system-ui" fontSize="10" fontWeight="700" fill="#FFFFFF">FLOOR 1 — EXTERIOR WALLS</text>
        {/* Rows. */}
        <MockRow y={66}  qty="32"  desc="2 X 6 X 92-5/8 PREMIUM SPRUCE" />
        <MockRow y={86}  qty="14"  desc="2 X 6 X 16 PREMIUM SPRUCE" />
        <MockRow y={106} qty="11"  desc="7/16 OSB SHEATHING 4X8" />
        <MockRow y={126} qty="3"   desc="9'X100' TYPAR HOUSEWRAP" />
        <MockRow y={146} qty="32 sf" desc="R22 INSULATION" />
      </g>
    </svg>
  );
}

function DimensionLabel({ x, y, text }) {
  // Approximation — the actual label width depends on the text but 28 is fine for "24.0'".
  return (
    <g>
      <rect x={x - 16} y={y - 7} width="32" height="14" rx="3" fill="#FFFFFF" />
      <text x={x} y={y + 3} textAnchor="middle" fontFamily="system-ui" fontSize="9" fontWeight="600" fill="#1A1A1A">{text}</text>
    </g>
  );
}

function MockRow({ y, qty, desc }) {
  return (
    <g>
      <text x="14"  y={y} fontFamily="system-ui" fontSize="9" fontWeight="600" fill="#1A1A1A">{qty}</text>
      <text x="44"  y={y} fontFamily="system-ui" fontSize="9" fontWeight="400" fill="#1A1A1A">{desc.length > 24 ? desc.slice(0, 24) + '…' : desc}</text>
      <line x1="14" x2="206" y1={y + 5} y2={y + 5} stroke="#F3F4F6" strokeWidth="0.5" />
    </g>
  );
}

// ============================================================
// Features (4 cards)
// ============================================================
function Features() {
  const cards = [
    { icon: IconHouse,    title: 'Draw Floor Plans',         body: 'Sketch exterior and interior walls, add openings, and let BuildTek calculate every material automatically from your drawing.' },
    { icon: IconChecklist,title: 'Instant Material Takeoff', body: "Your real SKU catalog with live pricing. Every stud, sheet, roll, and bag calculated from your store's actual inventory." },
    { icon: IconDocument, title: 'Send Professional Quotes', body: 'Generate branded PDF quotes and email them directly to your builders. Four price levels, margin analysis, and one-click delivery.' },
    { icon: IconSparkle,  title: 'AI Plan Reading',          body: "Upload a truss layout PDF and BuildTek's AI extracts roof measurements automatically — pitch, valley lengths, sheathing area and more." },
  ];
  return (
    <section id="features" className="lp-section lp-section-white">
      <div className="lp-container">
        <div className="lp-eyebrow">FEATURES</div>
        <h2 className="lp-section-title">Everything a dealer needs</h2>
        <p className="lp-section-sub">
          BuildTek is purpose-built for building supply stores — not adapted from generic construction software.
        </p>
        <div className="lp-feature-grid">
          {cards.map((c) => (
            <div key={c.title} className="lp-feature-card">
              <div className="lp-feature-icon">{c.icon()}</div>
              <h3 className="lp-feature-title">{c.title}</h3>
              <p className="lp-feature-body">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// How it works (3 steps)
// ============================================================
function HowItWorks() {
  const steps = [
    { n: '01', title: 'Draw Your Floor Plan', body: 'Use the built-in sketch tool to trace the exterior walls, add interior walls, windows, and doors. Works just like drawing on paper — but smarter.' },
    { n: '02', title: 'Get Your Material List', body: 'BuildTek calculates every material automatically — studs, plates, sheathing, insulation, drywall, roofing — using your real store SKUs and pricing.' },
    { n: '03', title: 'Send the Quote',        body: 'Generate a professional PDF quote with your store branding and email it directly to the builder. Track status, manage revisions, and analyze margins.' },
  ];
  return (
    <section id="how-it-works" className="lp-section lp-section-gray">
      <div className="lp-container">
        <h2 className="lp-section-title lp-centered">From sketch to quote in three steps</h2>
        <div className="lp-steps">
          {steps.map((s, i) => (
            <div key={s.n} className="lp-step">
              <div className="lp-step-num">{s.n}</div>
              <h3 className="lp-step-title">{s.title}</h3>
              <p className="lp-step-body">{s.body}</p>
              {i < steps.length - 1 && <div className="lp-step-connector" aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Image strip (3 Unsplash panels)
// ============================================================
function ImageStrip() {
  const panels = [
    { url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800', label: 'Residential Builds' },
    { url: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=800', label: 'Material Takeoffs' },
    { url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800', label: 'Professional Quotes' },
  ];
  return (
    <section className="lp-strip" aria-label="What we help dealers build">
      {panels.map((p) => (
        <div
          key={p.label}
          className="lp-strip-panel"
          style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url(${p.url})` }}
        >
          <div className="lp-strip-label">{p.label}</div>
        </div>
      ))}
    </section>
  );
}

// ============================================================
// About
// ============================================================
function About() {
  return (
    <section id="about" className="lp-section lp-section-white">
      <div className="lp-container lp-two-col">
        <div>
          <div className="lp-eyebrow">ABOUT</div>
          <h2 className="lp-section-title">Built by a building supply dealer, for building supply dealers</h2>
          <p className="lp-body">
            BuildTek was born out of frustration with existing estimating software that wasn't built for how lumber yards
            and building supply stores actually work. We needed a tool that understood our SKUs, our assemblies, our
            price levels, and our customers.
          </p>
          <p className="lp-body">
            Lyndhurst Home Building Centre has been supplying builders and homeowners across Eastern Ontario with
            quality building materials for years. BuildTek is the estimating platform we built for ourselves — and now
            we're making it available to dealers across Canada.
          </p>
        </div>
        <div className="lp-store-card">
          <div className="lp-store-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#CC0000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 C8 2 5 5 5 9 c0 5 7 13 7 13 s7 -8 7 -13 c0 -4 -3 -7 -7 -7 Z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </div>
          <div className="lp-store-name">Lyndhurst Home Building Centre</div>
          <div className="lp-store-line">397 Lyndhurst Rd, Lyndhurst ON K0E 1N0</div>
          <div className="lp-store-line">647-523-6585</div>
          <div className="lp-store-line">spencer7roberts@gmail.com</div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Contact
// ============================================================
function Contact() {
  return (
    <section id="contact" className="lp-section lp-section-gray">
      <div className="lp-container lp-two-col">
        <div>
          <div className="lp-eyebrow">CONTACT</div>
          <h2 className="lp-section-title">Get in touch</h2>
          <p className="lp-body">Interested in BuildTek for your store? We'd love to hear from you.</p>
          <div className="lp-contact-rows">
            <div className="lp-contact-row"><span>📍</span> 397 Lyndhurst Rd, Lyndhurst ON K0E 1N0</div>
            <div className="lp-contact-row"><span>📞</span> 647-523-6585</div>
            <div className="lp-contact-row"><span>✉️</span> spencer7roberts@gmail.com</div>
          </div>
        </div>
        <form
          className="lp-form"
          action="https://formsubmit.co/spencer7roberts@gmail.com"
          method="POST"
        >
          <input type="hidden" name="_subject" value="BuildTek landing page enquiry" />
          <input type="hidden" name="_captcha" value="false" />
          <input type="hidden" name="_template" value="table" />
          <label className="lp-label" htmlFor="lp-name">Name</label>
          <input id="lp-name" className="lp-input" name="name" type="text" required />
          <label className="lp-label" htmlFor="lp-email">Email</label>
          <input id="lp-email" className="lp-input" name="email" type="email" required />
          <label className="lp-label" htmlFor="lp-message">Message</label>
          <textarea id="lp-message" className="lp-input lp-textarea" name="message" rows="4" required />
          <button type="submit" className="lp-btn lp-btn-primary lp-form-submit">Send Message</button>
        </form>
      </div>
    </section>
  );
}

// ============================================================
// Footer
// ============================================================
function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-grid">
        <div>
          <img src="/buildtek-logo.svg?v=2" alt="BuildTek" height="32" />
          <p className="lp-footer-tag">Modernizing Building Material Takeoffs</p>
          <p className="lp-footer-copy">© 2026 BuildTek. Built by Lyndhurst Home Building Centre.</p>
        </div>
        <div>
          <h4 className="lp-footer-heading">Product</h4>
          <ul className="lp-footer-list">
            <li><a href="#features" className="lp-footer-link">Features</a></li>
            <li><a href="#how-it-works" className="lp-footer-link">How It Works</a></li>
            <li><Link to="/login" className="lp-footer-link">Log In</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="lp-footer-heading">Contact</h4>
          <ul className="lp-footer-list">
            <li>647-523-6585</li>
            <li>spencer7roberts@gmail.com</li>
            <li>Lyndhurst, Ontario</li>
          </ul>
        </div>
      </div>
      <div className="lp-footer-bar">Powered by BuildTek</div>
    </footer>
  );
}

// ============================================================
// Inline icons (stroke #CC0000)
// ============================================================
const iconProps = {
  width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none',
  stroke: '#CC0000', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
};
function IconHouse() {
  return (<svg {...iconProps}><path d="M3 11 L12 3 L21 11" /><path d="M5 10 V21 H19 V10" /><path d="M10 21 V14 H14 V21" /></svg>);
}
function IconChecklist() {
  return (<svg {...iconProps}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8 L10.5 9.5 L13.5 6.5" /><path d="M9 14 L10.5 15.5 L13.5 12.5" /><path d="M15.5 7.5 H17" /><path d="M15.5 13.5 H17" /></svg>);
}
function IconDocument() {
  return (<svg {...iconProps}><path d="M7 3 H15 L19 7 V21 H7 Z" /><path d="M15 3 V7 H19" /><path d="M9 12 H17" /><path d="M9 16 H17" /></svg>);
}
function IconSparkle() {
  return (<svg {...iconProps}><path d="M12 3 L13.5 9 L20 10.5 L13.5 12 L12 18 L10.5 12 L4 10.5 L10.5 9 Z" /><path d="M19 4 L19.5 5.5 L21 6 L19.5 6.5 L19 8 L18.5 6.5 L17 6 L18.5 5.5 Z" /></svg>);
}

// ============================================================
// All landing-page CSS, scoped via the `lp-` prefix so nothing leaks.
// ============================================================
const LANDING_CSS = `
html { scroll-behavior: smooth; }
body { margin: 0; }

.lp-nav, .lp-hero, .lp-section, .lp-strip, .lp-footer {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #1A1A1A;
  box-sizing: border-box;
}
.lp-nav *, .lp-hero *, .lp-section *, .lp-strip *, .lp-footer * { box-sizing: border-box; }

/* Navigation */
.lp-nav {
  position: fixed; top: 0; left: 0; right: 0; height: 64px; z-index: 100;
  background: rgba(10,10,10,0.95);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.lp-nav-inner {
  max-width: 1200px; margin: 0 auto; height: 100%;
  padding: 0 24px; display: flex; align-items: center; gap: 32px;
}
.lp-nav-brand { display: flex; align-items: center; }
.lp-nav-brand img { display: block; width: auto; }
.lp-nav-links { display: flex; align-items: center; gap: 28px; margin-left: auto; }
.lp-nav-link {
  font-size: 14px; font-weight: 500; color: #FFFFFF;
  text-decoration: none; transition: color 0.15s ease;
}
.lp-nav-link:hover { color: #CC0000; }
.lp-nav-cta {
  font-size: 14px; font-weight: 500; color: #FFFFFF;
  padding: 8px 18px; border: 1px solid rgba(255,255,255,0.6);
  border-radius: 6px; text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.lp-nav-cta:hover { background: #FFFFFF; color: #0A0A0A; border-color: #FFFFFF; }
.lp-nav-burger {
  display: none; background: transparent; border: none; cursor: pointer;
  padding: 8px; margin-left: auto;
}
.lp-nav-burger span {
  display: block; width: 22px; height: 2px; background: #FFFFFF; margin: 4px 0;
  transition: transform 0.2s ease;
}

/* Hero */
.lp-hero {
  position: relative; min-height: 100vh; background: #0A0A0A;
  color: #FFFFFF; padding: 96px 24px 64px; overflow: hidden;
}
.lp-hero-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
}
.lp-hero-inner {
  position: relative; max-width: 1200px; margin: 0 auto;
  display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;
  min-height: calc(100vh - 160px);
}
.lp-hero-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 20px; }
.lp-pill {
  display: inline-block; background: #CC0000; color: #FFFFFF;
  font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
  padding: 6px 14px; border-radius: 999px;
}
.lp-hero-title {
  font-size: 56px; font-weight: 700; line-height: 1.1;
  margin: 0; color: #FFFFFF; letter-spacing: -0.02em;
}
.lp-hero-sub {
  font-size: 20px; line-height: 1.55; color: #9CA3AF;
  margin: 0; max-width: 540px;
}
.lp-hero-ctas { display: flex; gap: 14px; margin-top: 8px; }
.lp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 48px; padding: 0 24px; border-radius: 6px;
  font-size: 15px; font-weight: 600; text-decoration: none;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  border: none; font-family: inherit;
}
.lp-btn-primary { background: #CC0000; color: #FFFFFF; }
.lp-btn-primary:hover { background: #AA0000; transform: translateY(-1px); }
.lp-btn-outline { background: transparent; color: #FFFFFF; border: 1px solid #FFFFFF; }
.lp-btn-outline:hover { background: #FFFFFF; color: #0A0A0A; }
.lp-hero-proof { font-size: 12px; color: #6B7280; margin-top: 6px; }
.lp-hero-art { display: flex; justify-content: center; align-items: center; }
.lp-hero-art svg { width: 100%; max-width: 540px; height: auto; }

/* Generic section */
.lp-section { padding: 80px 24px; }
.lp-section-white { background: #FFFFFF; }
.lp-section-gray { background: #F5F5F5; }
.lp-container { max-width: 1200px; margin: 0 auto; }
.lp-eyebrow {
  color: #CC0000; font-size: 12px; font-weight: 700;
  letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;
}
.lp-section-title {
  font-size: 36px; font-weight: 700; line-height: 1.2;
  margin: 0 0 14px; color: #1A1A1A; letter-spacing: -0.01em;
}
.lp-centered { text-align: center; margin-left: auto; margin-right: auto; max-width: 720px; }
.lp-section-sub {
  font-size: 16px; line-height: 1.7; color: #6B7280;
  margin: 0 0 48px; max-width: 720px;
}
.lp-body { font-size: 16px; line-height: 1.7; color: #1A1A1A; margin: 0 0 18px; }

/* Features grid */
.lp-feature-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px;
}
.lp-feature-card {
  background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px;
  padding: 32px; transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.lp-feature-card:hover {
  border-color: #CC0000; transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(0,0,0,0.06);
}
.lp-feature-icon { margin-bottom: 16px; }
.lp-feature-title { font-size: 18px; font-weight: 700; margin: 0 0 8px; color: #1A1A1A; }
.lp-feature-body { font-size: 14px; line-height: 1.65; color: #6B7280; margin: 0; }

/* Steps */
.lp-steps {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;
  position: relative; margin-top: 48px;
}
.lp-step { position: relative; padding: 0 8px; }
.lp-step-num {
  font-size: 48px; font-weight: 800; color: #CC0000;
  line-height: 1; margin-bottom: 16px; letter-spacing: -0.02em;
}
.lp-step-title { font-size: 20px; font-weight: 700; margin: 0 0 10px; color: #1A1A1A; }
.lp-step-body { font-size: 15px; line-height: 1.65; color: #6B7280; margin: 0; }
.lp-step-connector {
  position: absolute; top: 24px; left: calc(50% + 32px); right: calc(-50% + 32px);
  height: 0; border-top: 2px dashed #E5E7EB;
}

/* Image strip */
.lp-strip {
  display: grid; grid-template-columns: repeat(3, 1fr);
  height: 400px; background: #0A0A0A;
}
.lp-strip-panel {
  position: relative; background-size: cover; background-position: center;
  background-repeat: no-repeat;
  transition: filter 0.25s ease;
  display: flex; align-items: center; justify-content: center;
}
.lp-strip-panel:hover { filter: brightness(1.1); }
.lp-strip-label {
  color: #FFFFFF; font-size: 18px; font-weight: 600;
  letter-spacing: 0.4px; text-shadow: 0 2px 12px rgba(0,0,0,0.4);
}

/* Two-column (About / Contact) */
.lp-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: start; }
.lp-store-card {
  border: 1px solid #E5E7EB; border-radius: 12px; padding: 32px;
  background: #FFFFFF;
}
.lp-store-icon { margin-bottom: 12px; }
.lp-store-name { font-size: 18px; font-weight: 700; margin-bottom: 12px; color: #1A1A1A; }
.lp-store-line { font-size: 15px; color: #6B7280; margin-bottom: 6px; }

/* Contact */
.lp-contact-rows { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
.lp-contact-row {
  font-size: 15px; color: #1A1A1A; display: flex; align-items: center; gap: 12px;
}
.lp-contact-row span { font-size: 18px; }
.lp-form {
  background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px;
  padding: 32px; display: flex; flex-direction: column;
}
.lp-label {
  font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
  text-transform: uppercase; color: #6B7280;
  margin-bottom: 6px; margin-top: 12px;
}
.lp-label:first-child { margin-top: 0; }
.lp-input {
  font-family: inherit; font-size: 15px; color: #1A1A1A;
  padding: 11px 13px; border: 1px solid #E5E7EB; border-radius: 6px;
  background: #FFFFFF; transition: border-color 0.15s ease, box-shadow 0.15s ease;
  width: 100%;
}
.lp-input:focus { outline: none; border-color: #CC0000; box-shadow: 0 0 0 3px rgba(204,0,0,0.12); }
.lp-textarea { resize: vertical; min-height: 110px; }
.lp-form-submit { margin-top: 18px; align-self: flex-start; }

/* Footer */
.lp-footer { background: #0A0A0A; color: #9CA3AF; padding: 48px 24px 0; }
.lp-footer-grid {
  display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 48px;
  padding-bottom: 40px;
}
.lp-footer-tag { font-size: 14px; color: #6B7280; margin: 16px 0 8px; }
.lp-footer-copy { font-size: 13px; color: #6B7280; margin: 0; }
.lp-footer-heading { font-size: 14px; font-weight: 700; color: #FFFFFF; margin: 0 0 14px; }
.lp-footer-list { list-style: none; padding: 0; margin: 0; }
.lp-footer-list li { font-size: 14px; color: #9CA3AF; margin-bottom: 8px; }
.lp-footer-link { color: #9CA3AF; text-decoration: none; transition: color 0.15s ease; }
.lp-footer-link:hover { color: #FFFFFF; }
.lp-footer-bar {
  border-top: 1px solid #1F2937; text-align: center;
  padding: 18px 0; color: #4B5563; font-size: 12px;
}

/* Mobile */
@media (max-width: 768px) {
  .lp-nav-inner { gap: 16px; }
  .lp-nav-links {
    position: absolute; top: 64px; left: 0; right: 0;
    background: rgba(10,10,10,0.98); flex-direction: column; align-items: stretch;
    padding: 16px 24px; gap: 8px;
    display: none; border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .lp-nav-links-open { display: flex; }
  .lp-nav-link { padding: 10px 0; }
  .lp-nav-cta { text-align: center; margin-top: 8px; }
  .lp-nav-burger { display: block; }

  .lp-hero { padding: 84px 20px 48px; min-height: auto; }
  .lp-hero-inner { grid-template-columns: 1fr; gap: 32px; min-height: auto; }
  .lp-hero-art { display: none; }
  .lp-hero-title { font-size: 36px; }
  .lp-hero-sub { font-size: 17px; }

  .lp-section { padding: 56px 20px; }
  .lp-section-title { font-size: 28px; }
  .lp-feature-grid { grid-template-columns: 1fr; gap: 16px; }
  .lp-steps { grid-template-columns: 1fr; gap: 36px; }
  .lp-step-connector { display: none; }
  .lp-strip { grid-template-columns: 1fr; height: auto; }
  .lp-strip-panel { height: 200px; }
  .lp-two-col { grid-template-columns: 1fr; gap: 36px; }
  .lp-footer-grid { grid-template-columns: 1fr; gap: 32px; }
}
`;
