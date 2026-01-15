// src/App.js
import React from "react";
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
import Footer from "./components/Footer";

function App() {
  const path = window.location.pathname;

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

export default App;
