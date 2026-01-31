import React, { useState } from "react";
import { CloudRain, Wind, ArrowRight, Info } from "lucide-react";

const ForecastModels = () => {
    // State to toggle available models
    const [activeCategory, setActiveCategory] = useState(null);

    return (
        <section className="min-h-screen bg-slate-950 text-slate-50 pt-8 pb-12">
            <div className="max-w-6xl mx-auto px-4">

                {/* Header */}
                <div className="mb-12">
                    <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400">
                            FM
                        </span>
                        Forecast Models
                    </h1>
                    <p className="text-slate-400 max-w-2xl text-lg">
                        Explore numerical weather prediction data categorized by variable.
                        Select a category below to view available model runs.
                    </p>
                </div>

                {/* Main Grid: Variables */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* RAINFALL CARD */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-blue-500/40 transition-all group">
                        <div className="flex items-start justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <span className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
                                    <CloudRain className="h-6 w-6" />
                                </span>
                                <div>
                                    <h2 className="text-2xl font-semibold">Rainfall</h2>
                                    <p className="text-slate-400 text-sm">Accumulated Precipitation</p>
                                </div>
                            </div>
                        </div>

                        {/* Model Options for Rainfall */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available Models</h3>

                            {/* GFS (Active) */}
                            <a href="/rainfall" className="block">
                                <div className="flex items-center justify-between p-4 bg-slate-800/50 hover:bg-blue-600/10 border border-slate-700 hover:border-blue-500/50 rounded-xl transition-all cursor-pointer group-item">
                                    <div className="flex items-center gap-3">
                                        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                                        <div>
                                            <span className="font-bold text-slate-200">GFS</span>
                                            <span className="text-xs text-slate-500 ml-2">Global Forecast System (NOAA)</span>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-5 w-5 text-slate-600 group-hover/item:text-blue-400 transition-colors" />
                                </div>
                            </a>

                            {/* ECMWF (Coming Soon) */}
                            <div className="flex items-center justify-between p-4 bg-slate-900/30 border border-slate-800 rounded-xl opacity-60 cursor-not-allowed">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-slate-700"></div>
                                    <div>
                                        <span className="font-bold text-slate-500">ECMWF</span>
                                        <span className="text-xs text-slate-600 ml-2">European Model</span>
                                    </div>
                                </div>
                                <span className="text-xs font-mono bg-slate-800 text-slate-500 px-2 py-0.5 rounded">SOON</span>
                            </div>
                        </div>
                    </div>

                    {/* WIND CARD (Future) */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-cyan-500/40 transition-all">
                        <div className="flex items-start justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <span className="p-3 bg-cyan-500/10 text-cyan-400 rounded-xl">
                                    <Wind className="h-6 w-6" />
                                </span>
                                <div>
                                    <h2 className="text-2xl font-semibold">Wind</h2>
                                    <p className="text-slate-400 text-sm">Surface & Upper Air Winds</p>
                                </div>
                            </div>
                        </div>

                        {/* Model Options for Wind */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available Models</h3>

                            {/* ECMWF AIFS (Active) */}
                            <a href="/wind" className="block">
                                <div className="flex items-center justify-between p-4 bg-slate-800/50 hover:bg-cyan-600/10 border border-slate-700 hover:border-cyan-500/50 rounded-xl transition-all cursor-pointer group-item">
                                    <div className="flex items-center gap-3">
                                        <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse"></div>
                                        <div>
                                            <span className="font-bold text-slate-200">ECMWF AIFS</span>
                                            <span className="text-xs text-slate-500 ml-2">Artificial Intelligence Forecasting System</span>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-5 w-5 text-slate-600 group-hover/item:text-cyan-400 transition-colors" />
                                </div>
                            </a>
                        </div>

                        <div className="mt-4 p-3 bg-blue-900/10 rounded-lg border border-blue-900/20 text-xs text-blue-300 flex items-start gap-2">
                            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <p>Wind visualizations are currently in development. Check back later for 10m surface wind streamlines.</p>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
};

export default ForecastModels;
