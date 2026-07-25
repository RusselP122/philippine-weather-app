// src/components/About.jsx
import React, { useState } from "react";

const About = () => {
  const [lang, setLang] = useState("en");

  return (
    <section
      id="about"
      className="bg-slate-950 border-t border-slate-800 py-16"
    >
      <div className="max-w-4xl mx-auto px-4">
        {/* Heading + language toggle */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-50 mb-2">
            About Philippine Typhoon/Weather
          </h2>
          <p className="text-sm md:text-base text-slate-400 max-w-xl">
            {lang === "en"
              ? "Community built weather insights to support preparedness across the Philippines."
              : "Gawa ng komunidad na mga kaalaman sa panahon para makatulong sa paghahanda ng mga tao sa iba't ibang bahagi ng Pilipinas."}
          </p>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/70 border border-slate-700 px-2 py-1 text-xs md:text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Language
            </span>
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2 py-0.5 rounded-full border text-[11px] md:text-xs transition-colors ${
                lang === "en"
                  ? "bg-sky-500 text-slate-900 border-sky-400"
                  : "border-transparent hover:border-slate-600"
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLang("tl")}
              className={`px-2 py-0.5 rounded-full border text-[11px] md:text-xs transition-colors ${
                lang === "tl"
                  ? "bg-sky-500 text-slate-900 border-sky-400"
                  : "border-transparent hover:border-slate-600"
              }`}
            >
              Tagalog
            </button>
          </div>
        </div>

        {/* Body text that switches language */}
        <div className="space-y-6 text-sm md:text-base text-slate-300">
          <div className="space-y-2">
            {lang === "en" ? (
              <p>
                Philippine Typhoon/Weather is{" "}
                <span className="font-semibold">
                  not an official weather agency
                </span>
                . We are an independent project that uses publicly available
                information, model guidance, and AI tools to help visualize
                potential weather and tropical cyclone scenarios.
              </p>
            ) : (
              <p>
                Ang Philippine Typhoon/Weather ay{" "}
                <span className="font-semibold">
                  hindi opisyal na ahensiya ng panahon sa pilipinas
                </span>
                . Isa itong independent na proyekto na gumagamit ng
                pampublikong datos, modelo, at AI tools para mas malinaw na
                maipakita ang posibleng panahon at galaw ng bagyo.
              </p>
            )}
          </div>

          <div className="space-y-2">
            {lang === "en" ? (
              <p>
                Our forecasts and graphics are designed to complement, not
                replace, official bulletins. Always follow updates and warnings
                from{" "}
                <span className="font-semibold">
                  PAGASA, JTWC, JMA, and your local authorities
                </span>{" "}
                when making safety decisions.
              </p>
            ) : (
              <p>
                Ang mga forecast at larawan dito ay pang gabay lamang at{" "}
                <span className="font-semibold">hindi kapalit</span> ng
                opisyal na abiso. Palagi pa ring sundin ang mga update at
                babala mula sa{" "}
                <span className="font-semibold">
                  PAGASA, JTWC, JMA, at inyong lokal na awtoridad
                </span>{" "}
                kapag gagawa ng desisyon para sa kaligtasan.
              </p>
            )}
          </div>

          <div className="space-y-2">
            {lang === "en" ? (
              <p>
                We focus on highlighting{" "}
                <span className="font-semibold">
                  storm intensity, track, and rainfall trends
                </span>{" "}
                in a way that is easier to understand, so communities can get a
                clearer picture of possible impacts ahead of time.
              </p>
            ) : (
              <p>
                Nakatuon kami sa pagpapakita ng{" "}
                <span className="font-semibold">
                  lakas ng bagyo, direksiyon ng galaw, at ulan
                </span>{" "}
                sa paraang mas madaling maintindihan, para magkaroon ng mas
                malinaw na ideya ang mga komunidad sa posibleng epekto bago pa
                dumating ang masamang panahon.
              </p>
            )}
          </div>
        </div>

        {/* Footer note stays the same in English (you can add Tagalog if you want) */}
        <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs md:text-sm text-slate-400">
          <p>
            If you have feedback or spot something that looks incorrect, please
            treat it as experimental guidance and verify with official sources.
          </p>
          <p className="italic text-slate-500">
            "Plan using multiple sources. Act using official warnings."
          </p>
        </div>
      </div>
    </section>
  );
};

export default About;