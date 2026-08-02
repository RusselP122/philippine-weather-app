// src/App.js
import React from "react";
import { Analytics } from "@vercel/analytics/react";
import Navbar from "./components/Navbar";
import Features from "./components/Features";
import About from "./components/About";
import Forecast from "./components/Forecast";
import TCPositions from "./components/TCPositions";
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
import SpaghettiPlot from "./components/SpaghettiPlot";
import Footer from "./components/Footer";
import EnsoMonitor from "./components/EnsoMonitor";

import TropicalCyclonePrediction from "./components/TropicalCyclonePrediction";
import WeatherAdvisory from "./components/WeatherAdvisory";
import Lightning from "./components/Lightning";
import LiveRadar from "./components/LiveRadar";
import RiskArea from "./components/RiskArea";
import SupportUs from "./components/SupportUs";
import ForecastTrackComparison from "./components/ForecastTrackComparison";
import UnofficialForecastTrack from "./components/UnofficialForecastTrack";

function AppContent() {
  const path = window.location.pathname;

  if (path === "/lightning") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Lightning />
        </main>
      </div>
    );
  }

  if (path === "/radar") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <LiveRadar />
        </main>
      </div>
    );
  }

  if (path === "/about") {
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

  if (path === "/weather-advisory") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <WeatherAdvisory />
        </main>
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
        <main className="flex-grow flex flex-col">
          <Cyclone />
        </main>
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

  if (path === "/forecast-track-comparison") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <ForecastTrackComparison />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/unofficial-forecast-track") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <UnofficialForecastTrack />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/tc-positions") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TCPositions />
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
      </div>
    );
  }

  if (path === "/tc-prediction") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TropicalCyclonePrediction />
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

  if (path === "/spaghetti") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <SpaghettiPlot />
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

  if (path === "/risk-area") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <RiskArea />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/support" || path === "/donate") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <SupportUs />
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
