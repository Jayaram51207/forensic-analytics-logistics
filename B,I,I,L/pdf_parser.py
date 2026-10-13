import os
import re
import pdfplumber

def clean_address(text):
    if not text:
        return ""
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    cleaned = []
    for line in lines:
        line_lower = line.lower()
        # Skip label lines and typical checklist ID lines
        if any(lbl in line_lower for lbl in [
            "exporter details :", "consignee details :", "gstn type", 
            "branch sr.no", "type of exporter", "seal type", "ad code", 
            "pan :", "iec no", "gst no", "ie code", "rbi code", 
            "arn no", "mobile. no", "exporter invoice n", "consignee other re",
            "invoice no & date", "exporter's ref"
        ]):
            continue
        # Clean inline noise from side-by-side columns
        cleaned_line = line
        cleaned_line = re.sub(r'\bS/\d+.*$', '', cleaned_line) # Remove S/009 DT ...
        cleaned_line = re.sub(r'\bPE/\d+.*$', '', cleaned_line) # Remove PEMI invoice no
        cleaned_line = re.sub(r'\bCPS/\d+.*$', '', cleaned_line) # Remove CPS invoice no
        cleaned_line = re.sub(r'Buyer\'s Order.*$', '', cleaned_line, flags=re.IGNORECASE)
        cleaned_line = re.sub(r'Buyer \(if.*$', '', cleaned_line, flags=re.IGNORECASE)
        cleaned_line = re.sub(r'Other Reference.*$', '', cleaned_line, flags=re.IGNORECASE)
        
        cleaned_line = cleaned_line.strip()
        if not cleaned_line:
            continue
        # Remove lines that look like PAN or GSTIN labels
        if "pan :" in cleaned_line.lower() or "gstn" in cleaned_line.lower() or "gst no" in cleaned_line.lower():
            continue
        # Ignore standalone IEC codes
        if re.match(r'^\d{10}$', cleaned_line):
            continue
        cleaned.append(cleaned_line)
    return "\n".join(cleaned)

def parse_pdf(filepath):
    """
    Main PDF parser entry point.
    Detects if it's a checklist or standard invoice/packing list and runs the correct parser.
    """
    if not os.path.exists(filepath):
        return {}
        
    with pdfplumber.open(filepath) as pdf:
        full_text = ""
        for page in pdf.pages:
            full_text += (page.extract_text() or "") + "\n"
            
    if "CHECK LIST" in full_text.upper():
        return parse_checklist(filepath)
    else:
        return parse_invoice_packing_list(filepath)

def parse_checklist(filepath):
    data = {}
    with pdfplumber.open(filepath) as pdf:
        first_page = pdf.pages[0]
        w = first_page.width
        h = first_page.height
        
        # Crop left half (Exporter)
        left = first_page.crop((0, 0, w / 2, h))
        left_text = left.extract_text() or ""
        
        # Crop right half (Consignee)
        right = first_page.crop((w / 2, 0, w, h))
        right_text = right.extract_text() or ""
        
        full_text = ""
        for page in pdf.pages:
            full_text += (page.extract_text() or "") + "\n"

    # 1. Exporter / Shipper Details
    exporter_match = re.search(r"Exporter Details\s*:\s*(.*)", left_text, re.DOTALL | re.IGNORECASE)
    if exporter_match:
        exp_chunk = re.split(r"GSTN Type|Type Of Exporter|Port Discharge", exporter_match.group(1), flags=re.IGNORECASE)[0]
        data["shipper"] = clean_address(exp_chunk)
        
    # 2. Consignee Details
    consignee_match = re.search(r"Consignee Details\s*:\s*(.*)", right_text, re.DOTALL | re.IGNORECASE)
    if consignee_match:
        cons_chunk = re.split(r"AD Code|SEAL Type|Total Packages", consignee_match.group(1), flags=re.IGNORECASE)[0]
        data["consignee"] = clean_address(cons_chunk)
        
    # 3. Notify (Default to Consignee)
    data["notify"] = "SAME AS CONSIGNEE"
    data["also_notify"] = "SAME AS CONSIGNEE"
    
    # 4. Standard fields
    # S.B. No & Date
    sb_match = re.search(r"S\.B\s*No\s*&\s*Date\s*:\s*(\d+)\s+(\d{2}/\d{2}/\d{4})", full_text, re.IGNORECASE)
    if sb_match:
        data["sb_no_date"] = f"{sb_match.group(1)} DT. {sb_match.group(2)}"
        
    # Job No & Date
    job_match = re.search(r"Job\s*No\s*&\s*Date\s*:\s*([^\n]+)", full_text, re.IGNORECASE)
    if job_match:
        val = job_match.group(1).strip()
        val = val.split("File Ref")[0].strip()
        data["job_no"] = val
        
    # File Ref No
    ref_match = re.search(r"File\s*Ref\.\s*No\s*:\s*([^\n]+)", full_text, re.IGNORECASE)
    if ref_match:
        val = ref_match.group(1).strip()
        val = val.split("Name")[0].strip()
        data["file_ref_no"] = val
        
    # Port of Discharge
    pod_match = re.search(r"Port\s*Discharge\s*:\s*([^\n]+)", full_text, re.IGNORECASE)
    if pod_match:
        val = pod_match.group(1).strip()
        val = val.split("Total Packages")[0].strip()
        data["port_of_discharge"] = val.split("-")[0].strip()
        
    # Port of Final Destination
    fdest_match = re.search(r"Port\s*Final\s*Dest\s*:\s*([^\n]+)", full_text, re.IGNORECASE)
    if fdest_match:
        val = fdest_match.group(1).strip()
        val = val.split("No Of Containers")[0].strip()
        data["final_destination"] = val.split("-")[0].strip()
        
    # Country Final Dest
    cfdest_match = re.search(r"Country\s*Final\s*Dest\s*:\s*([^\n]+)", full_text, re.IGNORECASE)
    if cfdest_match:
        val = cfdest_match.group(1).strip()
        val = val.split("No Of Containers")[0].strip()
        data["country_of_dest"] = val.split("-")[0].strip()

    # Default Country of Origin
    data["country_of_origin"] = "INDIA"
    
    # Net Weight
    nw_match = re.search(r"Net\s*Weight\s*:\s*([\d\.,]+)", full_text, re.IGNORECASE)
    if nw_match:
        data["net_weight"] = f"{nw_match.group(1).strip()} KGS"
        
    # Gross Weight
    gw_match = re.search(r"Gross\s*Weight\s*:\s*([\d\.,]+)", full_text, re.IGNORECASE)
    if gw_match:
        data["gross_weight"] = f"{gw_match.group(1).strip()} KGS"
        
    # Total Packages
    pkg_match = re.search(r"Total\s*Packages\s*:\s*([\d\s\w]+)", full_text, re.IGNORECASE)
    if pkg_match:
        val = pkg_match.group(1).strip()
        val = re.split(r"Loose|Country|PKG|CTN|BAG|\n", val, flags=re.IGNORECASE)[0].strip()
        # Restore package suffix if possible
        suffix_match = re.search(r"(PKG|CTN|BAG|BAGS|CARTONS|PACKAGES)", pkg_match.group(1), re.IGNORECASE)
        suffix = f" {suffix_match.group(1).upper()}" if suffix_match else " PKGS"
        data["total_pkgs"] = val + suffix
        
    # Invoice No & Date
    inv_match = re.search(r"Invoice\s*No\s*:\s*([^\n\s]+)\s+Invoice\s*Date\s*:\s*(\d{2}/\d{2}/\d{4})", full_text, re.IGNORECASE)
    if not inv_match:
        inv_match = re.search(r"Invoice\s*No\s*:\s*(\S+)\s+Invoice\s*Date\s*:\s*(\d{2}/\d{2}/\d{4})", full_text, re.IGNORECASE)
    if inv_match:
        data["invoice_no_date"] = f"{inv_match.group(1).strip()} DT. {inv_match.group(2).strip()}"
        
    # Cargo Items Table parsing
    cargo_items = []
    lines = full_text.split("\n")
    for idx, line in enumerate(lines):
        line = line.strip()
        match = re.match(r"^(\d+)\s+(\d{8})\s+(.*)", line)
        if match:
            sl_no = match.group(1)
            ritc = match.group(2)
            desc = match.group(3).strip()
            
            qty = 0
            unit = "KGS"
            if idx + 1 < len(lines):
                next_line = lines[idx+1].strip()
                qty_match = re.match(r"^([\d\.,]+)\s+(\w+)", next_line)
                if qty_match:
                    qty = qty_match.group(1).replace(",", "")
                    unit = qty_match.group(2)
            
            cargo_items.append({
                "sl_no": sl_no,
                "hs_code": ritc,
                "description": desc,
                "qty": qty,
                "unit": unit
            })
            
    if cargo_items:
        descs = [item["description"] for item in cargo_items]
        data["cargo_desc"] = "\n".join(descs)
        data["hs_code"] = cargo_items[0]["hs_code"]
        data["cargo_items"] = cargo_items
        
    # Extract container details
    container_pattern = re.compile(r'\b[A-Z]{4}\d{7}\b')
    
    # Find all unique container numbers in the text and filename
    found_containers = []
    fname = os.path.basename(filepath)
    for match in container_pattern.finditer(fname):
        c_no = match.group(0)
        if c_no not in found_containers:
            found_containers.append(c_no)
            
    for match in container_pattern.finditer(full_text):
        c_no = match.group(0)
        if c_no not in found_containers:
            found_containers.append(c_no)
            
    net_wt_val = 0.0
    gross_wt_val = 0.0
    try:
        net_wt_val = float(data.get("net_weight", "0").split()[0].replace(",", ""))
    except: pass
    try:
        gross_wt_val = float(data.get("gross_weight", "0").split()[0].replace(",", ""))
    except: pass
        
    if found_containers:
        data["containers"] = []
        for idx, container_no in enumerate(found_containers):
            data["containers"].append({
                "container_no": container_no,
                "seal_no": "",
                "pkgs": data.get("total_pkgs", "") if idx == 0 else "",
                "net_wt": net_wt_val if idx == 0 else 0.0,
                "gross_wt": gross_wt_val if idx == 0 else 0.0,
                "cbm": 0.0
            })
    else:
        # Default row with packages and weights if no container was found
        data["containers"] = [{
            "container_no": "",
            "seal_no": "",
            "pkgs": data.get("total_pkgs", ""),
            "net_wt": net_wt_val,
            "gross_wt": gross_wt_val,
            "cbm": 0.0
        }]
        
    # Extract package range
    pkg_range_match = re.search(r"Package\s+From\s+Package\s+To[^\n]*\n[^\n]*\n\s*(\d+)\s+(\d+)", full_text, re.IGNORECASE)
    if pkg_range_match:
        data["package_from"] = int(pkg_range_match.group(1))
        data["package_to"] = int(pkg_range_match.group(2))
    else:
        data["package_from"] = 1
        try:
            val = int(data.get("total_pkgs", "").split()[0].replace(",", ""))
            data["package_to"] = val
        except:
            data["package_to"] = 1
            
    return data

def parse_invoice_packing_list(filepath):
    data = {}
    with pdfplumber.open(filepath) as pdf:
        first_page = pdf.pages[0]
        w = first_page.width
        h = first_page.height
        
        # Crop left half (Exporter/Consignee)
        left = first_page.crop((0, 0, w * 0.6, h))
        left_text = left.extract_text() or ""
        
        full_text = ""
        for page in pdf.pages:
            full_text += (page.extract_text() or "") + "\n"
            
    # 1. Exporter / Shipper Details
    exporter_match = re.search(r"Exporter\b(.*?)\bConsignee", left_text, re.DOTALL | re.IGNORECASE)
    if exporter_match:
        data["shipper"] = clean_address(exporter_match.group(1))
    else:
        # Alt fallback
        lines = left_text.split("\n")
        exp_lines = []
        for line in lines:
            if "consignee" in line.lower():
                break
            exp_lines.append(line)
        data["shipper"] = clean_address("\n".join(exp_lines))
        
    # 2. Consignee Details
    consignee_match = re.search(r"Consignee\b(.*?)\b(Pre-Carriage|Place of Receipt|Country of Origin|BY SEA|CHENNAI)", left_text, re.DOTALL | re.IGNORECASE)
    if consignee_match:
        data["consignee"] = clean_address(consignee_match.group(1))
    else:
        lines = left_text.split("\n")
        cons_lines = []
        start = False
        for line in lines:
            if "consignee" in line.lower():
                start = True
                continue
            if start:
                if any(k in line.lower() for k in ["pre-carriage", "place of receipt", "country of origin", "by sea", "chennai"]):
                    break
                cons_lines.append(line)
        data["consignee"] = clean_address("\n".join(cons_lines))
        
    # 3. Invoice No & Date
    match = re.search(r"([A-Za-z0-9_\-\/]+)\s+DT:?\s*(\d{2}\.\d{2}\.\d{4}|\d{2}/\d{2}/\d{4})", full_text, re.IGNORECASE)
    if match:
        data["invoice_no_date"] = f"{match.group(1)} DT. {match.group(2)}"
    else:
        # Fallback search
        for line in full_text.split("\n"):
            if "DT:" in line or "DT." in line or "dt" in line.lower():
                m = re.search(r"(\S+\/\S+|\S+)\s+(DT:|DT\.|dt|date:)?\s*(\d{2}[\./\-]\d{2}[\./\-]\d{4})", line, re.IGNORECASE)
                if m:
                    data["invoice_no_date"] = f"{m.group(1)} DT. {m.group(3)}"
                    break
                    
    # 4. Voyage & Ports
    vessel_match = re.search(r"Vessel\s*/\s*Flight\s*No\.\s*Port\s*of\s*Loading\s*\n*(.*?)\n", full_text, re.IGNORECASE)
    if vessel_match:
        parts = vessel_match.group(1).split()
        if len(parts) >= 2:
            val = parts[0]
            if "Terms" in val or "of" in val:
                data["vessel_voyage"] = "BY SEA"
            else:
                data["vessel_voyage"] = val
            
            pol = " ".join(parts[1:])
            if "Delivery" in pol:
                data["port_of_loading"] = "CHENNAI / INDIA"
            else:
                data["port_of_loading"] = pol
    else:
        # Fallbacks
        if "BY SEA" in full_text:
            data["vessel_voyage"] = "BY SEA"
        if "CHENNAI" in full_text:
            data["port_of_loading"] = "CHENNAI / INDIA"

    pod_match = re.search(r"Port\s*of\s*Discharge\s*Final\s*Destination\s*\n*(.*?)\n", full_text, re.IGNORECASE)
    if pod_match:
        parts = pod_match.group(1).split()
        if len(parts) >= 2:
            data["port_of_discharge"] = parts[0]
            data["final_destination"] = " ".join(parts[1:])
    else:
        if "SINGAPORE" in full_text:
            data["port_of_discharge"] = "SINGAPORE"
            data["final_destination"] = "SINGAPORE"
            data["country_of_dest"] = "SINGAPORE"
            
    origin_match = re.search(r"Country\s*of\s*Origin\s*of\s*Goods\s*Country\s*of\s*Final\s*Dest\s*\n*(.*?)\n", full_text, re.IGNORECASE)
    if origin_match:
        parts = origin_match.group(1).split()
        if len(parts) >= 2:
            data["country_of_origin"] = parts[0]
            data["country_of_dest"] = " ".join(parts[1:])
    else:
        data["country_of_origin"] = "INDIA"

    # 5. Weights & Packages
    pkg_match = re.search(r"PKGS:\s*(\d+)", full_text, re.IGNORECASE)
    if not pkg_match:
        pkg_match = re.search(r"(\d+)\s+PKGS", full_text, re.IGNORECASE)
    if pkg_match:
        data["total_pkgs"] = f"{pkg_match.group(1)} PACKAGES"
        
    nt_match = re.search(r"NT\.WT\s*\(KGS\)\s*:\s*([\d\.,]+)", full_text, re.IGNORECASE)
    if not nt_match:
        nt_match = re.search(r"Net\s*Weight\s*:\s*([\d\.,]+)", full_text, re.IGNORECASE)
    if nt_match:
        data["net_weight"] = f"{nt_match.group(1)} KGS"
        
    gr_match = re.search(r"GR\.WT\s*\(KGS\)\s*:\s*([\d\.,]+)", full_text, re.IGNORECASE)
    if not gr_match:
        gr_match = re.search(r"Gross\s*Weight\s*:\s*([\d\.,]+)", full_text, re.IGNORECASE)
    if gr_match:
        data["gross_weight"] = f"{gr_match.group(1)} KGS"

    # 6. Cargo items & description
    cargo_lines = []
    lines = full_text.split("\n")
    start_cargo = False
    for line in lines:
        if "Description of Goods" in line or "Marks & Nos." in line:
            start_cargo = True
            continue
            
        if start_cargo:
            if "Amount in words" in line or "Declaration" in line or "TOTAL" in line or "We declare" in line:
                break
            cleaned_line = line.strip()
            if cleaned_line and not any(h in cleaned_line for h in ["Quantity", "Rate", "Amount", "USD"]):
                cleaned_line = re.sub(r'\b\d+\.\d{2}\s+\d+\.\d{2}\b', '', cleaned_line) # strip rates
                cleaned_line = re.sub(r'\b\d+\.\d{3}\b', '', cleaned_line) # strip weights
                cleaned_line = cleaned_line.strip()
                if cleaned_line:
                    cargo_lines.append(cleaned_line)
                
    if cargo_lines:
        data["cargo_desc"] = "\n".join(cargo_lines)
        
    # Extract container details
    container_pattern = re.compile(r'\b[A-Z]{4}\d{7}\b')
    
    # Find all unique container numbers in the text and filename
    found_containers = []
    fname = os.path.basename(filepath)
    for match in container_pattern.finditer(fname):
        c_no = match.group(0)
        if c_no not in found_containers:
            found_containers.append(c_no)
            
    for match in container_pattern.finditer(full_text):
        c_no = match.group(0)
        if c_no not in found_containers:
            found_containers.append(c_no)
            
    net_wt_val = 0.0
    gross_wt_val = 0.0
    try:
        net_wt_val = float(data.get("net_weight", "0").split()[0].replace(",", ""))
    except: pass
    try:
        gross_wt_val = float(data.get("gross_weight", "0").split()[0].replace(",", ""))
    except: pass
        
    if found_containers:
        data["containers"] = []
        for idx, container_no in enumerate(found_containers):
            data["containers"].append({
                "container_no": container_no,
                "seal_no": "",
                "pkgs": data.get("total_pkgs", "") if idx == 0 else "",
                "net_wt": net_wt_val if idx == 0 else 0.0,
                "gross_wt": gross_wt_val if idx == 0 else 0.0,
                "cbm": 0.0
            })
    else:
        # Default row with packages and weights if no container was found
        data["containers"] = [{
            "container_no": "",
            "seal_no": "",
            "pkgs": data.get("total_pkgs", ""),
            "net_wt": net_wt_val,
            "gross_wt": gross_wt_val,
            "cbm": 0.0
        }]
        
    # Extract package range (mostly fallback for invoices/packing lists)
    pkg_range_match = re.search(r"Package\s+From\s+Package\s+To[^\n]*\n[^\n]*\n\s*(\d+)\s+(\d+)", full_text, re.IGNORECASE)
    if pkg_range_match:
        data["package_from"] = int(pkg_range_match.group(1))
        data["package_to"] = int(pkg_range_match.group(2))
    else:
        data["package_from"] = 1
        try:
            val = int(data.get("total_pkgs", "").split()[0].replace(",", ""))
            data["package_to"] = val
        except:
            data["package_to"] = 1
            
    return data
