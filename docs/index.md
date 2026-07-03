---
layout: home

hero:
  name: "Beacon"
  text: "Modern API Workspace"
  tagline: "Organize endpoints with folders, import from Postman, use dynamic variables & extractors, and run powerful load tests with real-time monitoring."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/nannndev/beacon
    - theme: alt
      text: Documentation
      link: /introduction

features:
  - icon: 📁
    title: Folders & Organization
    details: Full nested folder support like Postman. Group your APIs by service, environment, or feature.
  - icon: 📥
    title: Postman Import
    details: Import existing Postman collections while preserving your entire folder structure.
  - icon: 🔗
    title: Variables & Extractors
    details: Use {{random_email}}, {{uuid}}, timestamps and more. Extract tokens from responses to chain requests.
  - icon: 📊
    title: Live Load Testing
    details: Real-time monitoring, rate limit detection, concurrency control, and detailed response inspection.
  - icon: 🖥️
    title: Desktop App
    details: Native desktop experience powered by Tauri. Includes the backend as a sidecar for a true single-EXE experience.
  - icon: 🛡️
    title: Built for Security Testing
    details: Designed from the ground up for rate limit testing, abuse simulation, and chained authentication flows.
---