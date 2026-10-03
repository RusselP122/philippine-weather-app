// src/components/Policies.jsx
import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Lock,
  FileText,
  Database,
  Heart,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Scale,
  Compass,
  ArrowUpRight,
  Eye,
  RefreshCw,
} from "lucide-react";

const Policies = () => {
  // Determine initial tab from pathname or hash if available
  const getInitialTab = () => {
    const path = window.location.pathname.toLowerCase();
    if (path.includes("privacy")) return "privacy";
    if (path.includes("terms")) return "terms";
    if (path.includes("disclaimer")) return "disclaimer";
    if (path.includes("attribution") || path.includes("sources")) return "attribution";
    if (path.includes("support-policy") || path.includes("donations")) return "support";
    return "disclaimer"; // Default to safety disclaimer as most important
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  // Sync tab change with URL for shareable links
  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", `/${tabId === "disclaimer" ? "disclaimer" : tabId}`);
    }
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);

  const tabs = [
    {
      id: "disclaimer",
      label: "Safety & Disclaimer",
      icon: ShieldAlert,
      badge: "Crucial",
      badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    },
    {
      id: "privacy",
      label: "Privacy Policy",
      icon: Lock,
      badge: "RA 10173",
      badgeColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    },
    {
      id: "terms",
      label: "Terms of Service",
      icon: FileText,
      badge: "Usage Rules",
      badgeColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
    },
    {
      id: "attribution",
      label: "Data Attribution",
      icon: Database,
      badge: "Open Data",
      badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    },
    {
      id: "support",
      label: "Support Policy",
      icon: Heart,
      badge: "Voluntary",
      badgeColor: "text-rose-400 bg-rose-500/10 border-rose-500/30",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8 font-sans relative overflow-hidden">
      {/* Background Subtle Gradient Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10 space-y-10">
        {/* Header Section */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold uppercase tracking-wider shadow-inner">
            <Scale className="w-4 h-4" />
            Legal & Operational Guidelines
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Policies, Terms & Disclaimers
          </h1>
          <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-400 leading-relaxed">
            Philippine Typhoon/Weather is dedicated to transparent, responsible meteorological
            data presentation and ethical disaster preparedness support.
          </p>
          <div className="text-xs text-slate-500 flex items-center justify-center gap-2 pt-1">
            <span>Last Updated: October 2026</span>
            <span>•</span>
            <span>Jurisdiction: Republic of the Philippines</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-xl shadow-lg">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-gradient-to-r from-cyan-500/20 to-blue-600/20 text-cyan-300 border border-cyan-500/40 shadow-md shadow-cyan-950/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-cyan-400" : "text-slate-400"}`} />
                <span>{tab.label}</span>
                <span
                  className={`hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono rounded-md border ${tab.badgeColor}`}
                >
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Safety & Meteorological Disclaimer */}
        {activeTab === "disclaimer" && (
          <div className="space-y-8 animate-fadeIn">
            {/* Urgent Red Warning Box */}
            <div className="rounded-2xl bg-gradient-to-r from-amber-950/40 via-red-950/30 to-amber-950/40 border border-amber-500/40 p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg sm:text-xl font-bold text-amber-300">
                    Important Public Safety & Non-Affiliation Notice
                  </h2>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    <strong>Philippine Typhoon/Weather is NOT an official meteorological government agency.</strong>{" "}
                    We are an independent, community-driven civic tech project using publicly available weather models,
                    AI simulations, and open science data to provide visual insights.
                  </p>
                  <p className="text-xs sm:text-sm text-amber-200/90 font-medium pt-1">
                    For official storm signal alerts, school/work cancellations, maritime warnings, and evacuation orders,
                    always consult and follow{" "}
                    <a
                      href="https://bagong.pagasa.dost.gov.ph/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-amber-400 font-semibold hover:text-white inline-flex items-center gap-1"
                    >
                      DOST-PAGASA <ExternalLink className="w-3 h-3" />
                    </a>
                    ,{" "}
                    <a
                      href="https://phivolcs.dost.gov.ph/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-amber-400 font-semibold hover:text-white inline-flex items-center gap-1"
                    >
                      DOST-PHIVOLCS <ExternalLink className="w-3 h-3" />
                    </a>
                    , the <strong>NDRRMC</strong>, and your <strong>Local Government Unit (LGU / CDRRMO / MDRRMO)</strong>.
                  </p>
                </div>
              </div>
            </div>

            {/* Detailed Clauses Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
              <h3 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Compass className="w-5 h-5 text-cyan-400" />
                1. Statutory Context & Legal Authority in the Philippines
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Under <strong>Republic Act No. 10692</strong> (PAGASA Modernization Act) and{" "}
                <strong>Republic Act No. 10121</strong> (Philippine Disaster Risk Reduction and Management Act of 2010),
                the Philippine Atmospheric, Geophysical and Astronomical Services Administration (DOST-PAGASA) holds the
                sole statutory mandate to declare official Tropical Cyclone Wind Signals (TCWS) and heavy rainfall advisories
                within the Philippine Area of Responsibility (PAR).
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">
                Any forecast tracks, spaghetti plots, wind vectors, and rainfall accumulation maps presented on this website
                represent <em>supplementary scientific research and model simulations</em>. They do not constitute official
                warnings and must never supersede instructions issued by civil defense authorities.
              </p>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-cyan-400" />
                2. AI Models, Ensembles & Experimental Guidance
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                This platform displays outputs from cutting-edge Artificial Intelligence Numerical Weather Prediction (AI-NWP)
                systems, including <strong>ECMWF AIFS</strong>, <strong>NOAA/NCEP AI-GFS</strong>, <strong>Google DeepMind WeatherNext</strong>,
                ensemble spaghetti members, and satellite infrared algorithms (Himawari-9). While AI models offer rapid computation and valuable trend forecasts:
              </p>
              <ul className="list-disc list-inside text-sm text-slate-300 space-y-2 pl-2">
                <li>AI models can produce sudden trajectory shifts or forecast artifacts, especially beyond 72 hours.</li>
                <li>Radar imagery and automated telemetry (PAGASA / GarbinWX composite network) are subject to upstream latency, regional radar maintenance, or sensor blind spots.</li>
                <li>Rainfall accumulations and intensity classifications are algorithmic estimates, not ground-truth rain gauge measurements.</li>
              </ul>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-cyan-400" />
                3. Limitation of Liability
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                The information on this website is provided on an <strong>"AS IS"</strong> and <strong>"AS AVAILABLE"</strong> basis
                without warranties of any kind, whether express, implied, or statutory. To the fullest extent permissible by applicable law:
              </p>
              <ul className="list-disc list-inside text-sm text-slate-300 space-y-2 pl-2">
                <li>The creators, contributors, and server maintainers of Philippine Typhoon/Weather disclaim any liability for direct, indirect, incidental, punitive, or consequential damages resulting from reliance on the information provided.</li>
                <li>We are not responsible for actions taken, preparations made, travel bookings, commercial delays, or property damage resulting from interpretations of this site's maps or model outputs.</li>
                <li>Mariners, aviators, and transport operators must rely strictly on official maritime safety broadcasts, METAR/TAF advisories, and Coast Guard travel advisories.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 2: Privacy Policy */}
        {activeTab === "privacy" && (
          <div className="space-y-8 animate-fadeIn">
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Privacy Policy
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Compliant with Republic Act No. 10173 (Data Privacy Act of 2012)
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                At <strong>Philippine Typhoon/Weather</strong>, your privacy and digital security are fundamental values.
                Because our primary goal is public safety and disaster awareness, our service is intentionally designed
                to collect the absolute minimum data required to keep the website operational and performant.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    No User Accounts or Sign-ups
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    You do not need to register, log in, or give us your name, email, or telephone number to view full-resolution radar, cyclone forecasts, or earthquake tracks.
                  </p>
                </div>

                <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    We Never Sell Your Data
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    We do not sell, rent, or barter any visitor information to third-party data brokers, marketing firms, or behavioral advertising platforms.
                  </p>
                </div>
              </div>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Eye className="w-5 h-5 text-cyan-400" />
                1. Information We Process
              </h3>
              <div className="space-y-3 text-sm text-slate-300">
                <p>
                  <strong>A. Anonymous Analytics:</strong> We use privacy-conscious analytics (such as Vercel Analytics)
                  to capture aggregated, de-identified technical metrics (e.g., page visit counts, device category, screen resolution,
                  and general geographic region like "Philippines"). These metrics allow us to auto-scale cloud servers and prevent downtime during super typhoons.
                </p>
                <p>
                  <strong>B. Local Geolocation (Client-Side Only):</strong> If you click the "Locate Me" or "Center on Current Position"
                  button on our Live Doppler Radar or interactive maps, your browser asks for GPS permission. This coordinate lookup
                  occurs <em>strictly inside your browser</em> to pan the map to your location. Your coordinates are <strong>never</strong> transmitted
                  to or stored on our servers.
                </p>
                <p>
                  <strong>C. Local Browser Storage:</strong> We use standard browser <code className="text-cyan-300 font-mono text-xs">localStorage</code> and{" "}
                  <code className="text-cyan-300 font-mono text-xs">sessionStorage</code> to remember your display preferences (such as radar transparency, map layer selections, and reload recovery flags). You can wipe this data at any time by clearing your browser cache.
                </p>
              </div>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Scale className="w-5 h-5 text-cyan-400" />
                2. Your Rights Under Philippine RA 10173
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Under the Data Privacy Act of 2012, data subjects possess rights including the right to be informed, right of access,
                right to object, and right to erasure. Because we do not associate logs with personal identities or keep individual profiles,
                most processing is entirely anonymous. If you have questions regarding privacy or data handling, you may reach out
                through our official Facebook community page or repository channels.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Terms of Service */}
        {activeTab === "terms" && (
          <div className="space-y-8 animate-fadeIn">
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Terms of Service
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Rules and conditions for accessing and utilizing this platform
                  </p>
                </div>
              </div>

              <h3 className="text-base sm:text-lg font-semibold text-slate-100">
                1. Acceptance of Terms
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                By accessing or browsing Philippine Typhoon/Weather, you acknowledge that you have read, understood,
                and agree to be bound by these Terms of Service and the accompanying Safety Disclaimer. If you do not
                agree, you should refrain from using this service.
              </p>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100">
                2. Permissible & Community Use
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                You are granted a non-exclusive, revocable, non-commercial license to access the site for:
              </p>
              <ul className="list-disc list-inside text-sm text-slate-300 space-y-1.5 pl-2">
                <li>Personal weather monitoring and disaster preparedness.</li>
                <li>Educational, academic research, and community public safety discussion.</li>
                <li>Sharing static screenshots or forecasts on social media, provided that <strong>proper attribution</strong> is given to Philippine Typhoon/Weather and underlying data agencies (PAGASA, ECMWF, NOAA, etc.).</li>
              </ul>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100">
                3. Prohibited Misuse & Fair Use Policy
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                To guarantee high availability for millions of Filipinos during life-threatening severe weather, you agree NOT to:
              </p>
              <ul className="list-disc list-inside text-sm text-slate-300 space-y-2 pl-2">
                <li>
                  <strong>Abusive Automated Scraping:</strong> Execute automated bots, crawlers, or high-frequency scripts that flood radar tile servers or Supabase API endpoints.
                </li>
                <li>
                  <strong>Denial of Service (DoS):</strong> Engage in any activity that impairs or overloads server bandwidth or disrupts emergency public access.
                </li>
                <li>
                  <strong>Disinformation or Panic-Mongering:</strong> Doctor, crop, or misrepresent model charts to fabricate false storm warnings, unverified tsunami alerts, or fake signal warnings that violate Republic Act No. 10175 or public order statutes.
                </li>
              </ul>

              <div className="h-px bg-slate-800" />

              <h3 className="text-base sm:text-lg font-semibold text-slate-100">
                4. Availability & Modifications
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                We make reasonable efforts to maintain uninterrupted uptime during severe weather events. However,
                we do not guarantee continuous, bug-free, or unhampered availability. We reserve the right to modify,
                throttle, or update site components at any time without liability.
              </p>
            </div>
          </div>
        )}

        {/* Tab 4: Data Sources & Attribution */}
        {activeTab === "attribution" && (
          <div className="space-y-8 animate-fadeIn">
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Data Sources & Scientific Attribution
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Gratefully acknowledging the scientific agencies making open meteorological data possible
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                Philippine Typhoon/Weather relies on open science datasets, public telemetry, and meteorological feeds
                from distinguished domestic and international institutions:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">DOST-PAGASA</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Philippines</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Official synoptic reports, Doppler radar network telemetry, tropical cyclone advisories, and regional rainfall advisories.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">DOST-PHIVOLCS</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Philippines</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Volcano alert levels, seismological monitoring data, and Philippine seismic network event bulletins.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">ECMWF (AIFS / IFS)</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">Europe</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    OpenData global forecast guidance, ECMWF Artificial Intelligence Forecasting System (AIFS), and ensemble track distributions.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">NOAA / NCEP (GFS / AI-GFS)</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">USA</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Global Forecast System (GFS), AI-GFS experimental models, and GEFS ensemble spaghetti guidance.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">JMA (Himawari-9)</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">Japan</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Geostationary meteorological satellite infrared, water vapor, and visible imagery over the Western Pacific.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">Google DeepMind (WeatherNext)</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/30">AI Research</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    WeatherNext deep-learning neural weather prediction models providing 15-day synoptic projections, 6-hourly precipitation accumulations, and atmospheric boundary guidance.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">GarbinWX</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30">Radar Telemetry</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Nationwide Doppler radar composites, authentic calibrated reflectivity (1 to 66+ dBZ) color processing, and high-frequency radar archive pipelines.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 text-sm">JTWC & USGS</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">International</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Joint Typhoon Warning Center tropical cyclone warnings & United States Geological Survey real-time earthquake telemetry.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Voluntary Support & Donations Policy */}
        {activeTab === "support" && (
          <div className="space-y-8 animate-fadeIn">
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
                  <Heart className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Voluntary Support & Donations Policy
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Transparent guidelines for user contributions and server funding
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                Philippine Typhoon/Weather is a passion-driven community initiative funded out-of-pocket and assisted by
                voluntary donations from generous weather enthusiasts and community members.
              </p>

              <div className="space-y-4 text-sm text-slate-300">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2">
                    <Info className="w-4 h-4 text-rose-400" />
                    1. Dedicated Allocation of Funds
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    All financial contributions via MariBank InstaPay, GCash, or Ko-fi are applied toward server hosting,
                    Supabase cloud egress bandwidth, model rendering hardware costs, and domain maintenance to keep the
                    service free and online for everyone.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2">
                    <Info className="w-4 h-4 text-rose-400" />
                    2. Strictly Voluntary & Non-Commercial
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Donations are voluntary gifts made without expectation of commercial return, financial dividends, or
                    exclusive consulting services. Contributions do not establish a client-contractor relationship.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2">
                    <Info className="w-4 h-4 text-rose-400" />
                    3. No Refunds
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Because contributions immediately support operational cloud infrastructure, all donations are final
                    and non-refundable. We deeply appreciate every peso sent to keep this public service alive!
                  </p>
                </div>
              </div>

              <div className="pt-2 flex justify-center">
                <a
                  href="/support"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-rose-500 to-amber-500 text-white font-semibold text-xs tracking-wide shadow-lg shadow-rose-950/40 hover:from-rose-600 hover:to-amber-600 transition-all active:scale-95"
                >
                  <Heart className="w-4 h-4 fill-white" />
                  Visit the Support Us Page
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Contact & Community Card */}
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 p-6 sm:p-8 text-center space-y-3">
          <h3 className="text-base font-semibold text-white">Have questions or feedback about our policies?</h3>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
            We value community input. If you notice data discrepancies or have privacy inquiries,
            connect with our administrator on our official Facebook community page.
          </p>
          <div className="pt-2">
            <a
              href="https://www.facebook.com/profile.php?id=100092463782813"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-sky-600 text-slate-200 hover:text-white transition-all text-xs font-medium border border-slate-700/60"
            >
              Contact on Facebook Page <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Policies;
