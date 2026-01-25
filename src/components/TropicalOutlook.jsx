// src/components/TropicalOutlook.jsx
import React, { useState } from "react";

// Build dynamic date string for today in YYYY-MM-DD format to match
// filenames like cyclone_development_areas_2025-11-18.png
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const todayDateStr = `${yyyy}-${mm}-${dd}`;

const TropicalOutlook = () => {
  const [activeTab, setActiveTab] = useState('week1');

  return (
    <section className="bg-slate-950 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-50 mb-2">
              Tropical Weather Outlook
            </h1>
            <p className="text-sm md:text-base text-slate-400 max-w-xl">
              Overview of areas with potential tropical cyclone development over
              the next few days, focusing on systems that may affect the
              Philippine Area of Responsibility (PAR).
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-8 items-start">
          {/* Outlook map / graphic */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              {/* Controls */}
              <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
                <button
                  onClick={() => setActiveTab('week1')}
                  className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'week1'
                    ? 'bg-slate-800 text-white shadow-sm ring-1 ring-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  Week 1 (Day 1-7)
                </button>
                <button
                  onClick={() => setActiveTab('week2')}
                  className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'week2'
                    ? 'bg-slate-800 text-white shadow-sm ring-1 ring-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  Week 2 (Day 8-14)
                </button>
              </div>

              <span className="font-mono text-[11px] text-slate-500">
                Updated Weekly
              </span>
            </div>
            <div className="h-80 md:h-[26rem] flex items-center justify-center bg-slate-900 relative">
              {/* Image for Week 1 */}
              <img
                src="/images/tropical_outlook_week1_latest.png"
                alt="Tropical weather outlook Week 1"
                className={`h-full w-full object-contain absolute transition-opacity duration-300 ${activeTab === 'week1' ? 'opacity-100' : 'opacity-0'}`}
              />
              {/* Image for Week 2 */}
              <img
                src="/images/tropical_outlook_week2_latest.png"
                alt="Tropical weather outlook Week 2"
                className={`h-full w-full object-contain absolute transition-opacity duration-300 ${activeTab === 'week2' ? 'opacity-100' : 'opacity-0'}`}
              />
            </div>
          </div>

          {/* Text guidance */}
          <aside className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 text-sm text-slate-200">
            <div>
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                How to use this outlook
              </h2>
              <p className="text-xs md:text-sm text-slate-300">
                Colored areas and markers highlight regions where tropical
                cyclones could develop within the next several days. Use this
                together with the Tropical Cyclone Track and AI Forecast pages
                for a complete situational picture.
              </p>
            </div>
            <div className="border-t border-slate-800 pt-4 space-y-2 text-xs md:text-sm">
              <p className="text-slate-300">
                This outlook is experimental and for guidance only. Always refer
                to official outlooks and bulletins from PAGASA, JTWC, JMA and
                other national meteorological services for decision making.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
};

export default TropicalOutlook;
