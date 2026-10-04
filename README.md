> **New (Oct 2026):** the working rebuild lives in [`app/`](app/README.md). It uses real UK Power Networks data, flood scenarios, live faults and a responsive 2D/3D map. Everything below describes the earlier experiments.

# CreDayo - Infrastructure Resilience Platform

Interactive cascade simulation platform for electrical grid analysis with 2D/3D visualization.

## 🚀 Live Demo Links

- **[Optimized 2D View](https://credayo.vercel.app/?optimized=true)** - Fast-loading electrical cascade simulation
- **[3D Cesium View](https://credayo.vercel.app/test-infrastructure-cascade-correct.html)** - 3D globe with infrastructure overlay
- **[Performance Comparison](https://credayo.vercel.app/)** - Compare optimized vs original versions

## ⚡ Key Features

### Electrical Cascade Simulation
- **Correct hierarchy**: Primary → Secondary → Buildings
- **Real-world distances**: 4km primary radius, 640m secondary radius (London adjusted)
- **Impact zones**: Critical (100%) → High (95%) → Medium (85%) → Low (70%)
- **Persistent visualization**: Circles remain until manually reset

### Performance Optimizations
- **Fast loading**: ~2 seconds vs 30+ seconds (original)
- **10% asset strategy**: Load 7 initial assets vs 1000s
- **Single service architecture**: Eliminates memory leaks and freezing
- **Ground-aligned circles**: Stay horizontal regardless of map tilt/rotation

### 3D Visualization
- **Cesium integration**: Full 3D globe navigation
- **OSM Buildings**: Realistic building context
- **Infrastructure overlay**: Asset markers on 3D terrain

## 🛠️ Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Mapping**: MapTiler SDK + Cesium
- **Styling**: Tailwind CSS
- **Deployment**: Vercel

## 🎯 Demo Instructions

### 2D Cascade Simulation:
1. Click any red dot (primary substation)
2. Click "Simulate Cascade (Circles)"
3. Watch animated ripples show impact zones (3 cycles)
4. Tilt/rotate map - circles stay ground-aligned
5. Click "Reset Impact Zones" to clear

### 3D Navigation:
1. Navigate around London in 3D
2. Click on infrastructure assets for details
3. Demonstrate 3D perspective of infrastructure layout

## 📊 Performance Comparison

| Metric | Original | Optimized | Improvement |
|--------|----------|-----------|-------------|
| Loading Time | 30+ seconds | ~2 seconds | 93% faster |
| Initial Assets | 1000s | 7 | 99% reduction |
| Memory Usage | Heavy | Lightweight | Stable |
| User Experience | Freezing | Smooth | No crashes |

## 🔧 Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 🌍 Environment Variables

For deployment, set:
```
VITE_MAPTILER_API_KEY=your_maptiler_api_key_here
```

---

**Built for infrastructure resilience analysis and electrical grid cascade modeling.**