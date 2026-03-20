// src/App.js
import React from "react";
import { Analytics } from "@vercel/analytics/react";
import Navbar from "./components/Navbar";
import Features from "./components/Features";
import About from "./components/About";
import Forecast from "./components/Forecast";
import Cyclone from "./components/Cyclone";
import TropicalOutlook from "./components/TropicalOutlook";
import TropicalCycloneInformation from "./components/TropicalCycloneInformation";
import Weather from "./components/Weather";
import Alert from "./components/alert";
import Warning from "./components/Warning";
import Earthquake from "./components/Earthquake";
import DailySynoptic from "./components/DailySynoptic";
import Volcanoes from "./components/Volcanoes";
import ForecastModels from "./components/ForecastModels";
import Footer from "./components/Footer";
import EnsoMonitor from "./components/EnsoMonitor";
import LightningDetection from "./components/LightningDetection";

function AppContent() {
  const path = window.location.pathname;

  if (path === "/about") {
    // ... (trimmed for brevity, tool only applies the diff)
    // Actually I need to target the imports and the specific route block.

    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <About />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/tc-info") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TropicalCycloneInformation />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/outlook") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TropicalOutlook />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/cyclone") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Cyclone />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/forecast") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Forecast />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/weather") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Weather />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/alert") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Alert />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/warning") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Warning />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/earthquake") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Earthquake />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/synoptic-reports") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <DailySynoptic />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/volcanoes") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Volcanoes />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/forecast-models") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <ForecastModels />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/enso") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <EnsoMonitor />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/lightning") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <LightningDetection />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <Navbar />
      <main className="flex-grow">
        <Features />
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <>
      <AppContent />
      <Analytics />
    </>
  );
}

export default App;
