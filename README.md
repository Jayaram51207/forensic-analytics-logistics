# Leadking Logistics Suite

A comprehensive ecosystem of workflow automation, real-time synchronization, financial quoting, and 3D cargo stuffing visualizers developed to optimize freight operations at **Leadking Logistics**.

This repository showcases four production-grade logistics tools built using a modern, multi-language stack (JavaScript/Node.js, Three.js, Python, and C#/.NET WPF).

---

## 🛠️ Project Portfolio & Technical Highlights

### 1. 📦 3D Load & Stuffing Visualizer
An interactive cargo load optimization app that simulates container stuffing layouts to maximize space utilization.
* **Architecture:** Desktop container wrapping a React/Vite frontend using **PyWebview**, served via a multithreaded local Python server.
* **3D Engine:** Built using **Three.js** (WebGL) and OrbitControls for dynamic isometric, top, side, and back camera projections.
* **Physics & Layout Algorithms:** Implements smart container dimensions scaling, custom cylinder layouts (barrels on pallets), loop strapping on container bags, and a **dynamic compression pass** (simulating 7% vertical bag compression when heavy cargo is stacked on top).
* **Reporting:** Exports high-fidelity, client-ready PDF reports with container layout snapshots using canvas drawing buffer grabs and native OS save dialogues.
* **Tech Stack:** JavaScript (ES6+), Three.js, Vite, Python, PyWebview, HTML5/CSS3.

### 2. 💰 EasyQuote (Freight Billing Workspace)
An interactive desktop workspace designed to generate and share customer freight and shipping quotes instantly.
* **UI/UX:** Responsive C# **WPF** layout featuring customized color themes (Green for Chennai Port LCL/20ft/40ft and Blue for Tuticorin Port LCL/20ft/40ft).
* **Dynamic Grid:** Supports real-time addition/deletion of charge rows (Documentation, CFS, Handling, VGM, Fumigation) and auto-generates live email-compliant HTML tables.
* **One-Click Sharing:** Implements a direct HTML-to-Clipboard copy wrapper, allowing freight operators to copy styled tables with inline CSS and paste them directly into Outlook/Gmail/Word.
* **Integration:** Auto-saves and exports structured shipping quotes to Excel using **ClosedXML**.
* **Tech Stack:** C#, WPF (.NET), ClosedXML (Excel Engine), MS Win32 API.

### 3. 📄 B.I.I.L. (Logistics Document Generator)
A standalone command-line and compiled utility suite for logistics sheet compliance and automated formatting.
* **Core Functions:** Takes raw invoice, packing, and shipment inputs to compile and validate Air Waybill (AWB) instructions, Bill of Lading (BL) instruction spreadsheets, and invoice packages.
* **Automation:** Saves hours of manual entry by populating complex multi-tab logistics templates.
* **Tech Stack:** Python, Pandas, OpenPyXL, PyInstaller.

### 4. 🔄 Workflow Synchronizer (Real-Time Team Dashboard)
A multi-user LAN collaboration server that tracks shipment workflows from booking to custom clearance in real-time.
* **Real-time Engine:** Uses **Server-Sent Events (SSE)** to instantly broadcast shipment creations (`job_created`), checklist updates, and action logs to all office users on the LAN.
* **AI/PDF Data Extraction:** Integrates a Python subprocess compiler that parses uploaded shipment checklist PDFs and populates corresponding job fields automatically.
* **Administrative Controls:** Includes secure Admin access checks, real-time log history tracking, and localized database management.
* **Tech Stack:** Node.js, Express, SSE, Multer, Python Subprocess, HTML/CSS/JS.

---

## 🚀 Setup & Execution

### 1. Running the 3D Stuffing Visualizer
```bash
cd 3D_stuffing_visualizer
npm install
npm run build
python app.py
```

### 2. Running the Workflow Synchronizer
```bash
cd "Workflow syncroniser"
npm install
node server.js
```

### 3. Opening EasyQuote
* Open `EasyQuote/EasyQuote.sln` or the `.csproj` file in **Visual Studio**.
* Build and run the project (`F5`) to boot the WPF application.

---

## 📈 Impact & Outcomes
* **Time Savings:** Replaced manual Excel data entry for AWB/BL documentation with automation scripts, reducing processing time by over 70%.
* **Zero Visual Guesswork:** Allowed operators to visualize exact volumetric loads prior to truck/container arrivals, preventing cargo rejection at CFS.
* **Seamless Invoicing:** Streamlined customer quote workflows from several minutes of manual formatting to a single-click email copy-paste operation.
