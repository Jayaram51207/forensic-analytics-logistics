import os
import sys
import tkinter as tk

sys.path.append(r"c:\Users\vkmsd\OneDrive\Desktop\B,I,I,L")
from unified_generator import UnifiedGeneratorApp
import pdf_parser

def test_cotton_generation():
    app = UnifiedGeneratorApp()
    app.withdraw()
    
    templates_dir = r"c:\Users\vkmsd\OneDrive\Desktop\B,I,I,L\Templates"
    checklist_path = os.path.join(templates_dir, "Checklist_CHX03_568 CTNS_3416491 20052026_MRKU2367848.pdf")
    
    print("Parsing checklist:", checklist_path)
    data = pdf_parser.parse_pdf(checklist_path)
    
    app.apply_parsed_data(data)
    app.sync_billing_metadata()
    app.recalculate_totals()
    app.recalculate_billing()
    
    print("bl_template_var:", app.bl_template_var.get())
    
    # Let's call the generation code from generate_all
    dest_dir = r"c:\Users\vkmsd\OneDrive\Desktop\B,I,I,L\Generated"
    os.makedirs(dest_dir, exist_ok=True)
    
    # Calculate inv and filenames exactly as in generate_all
    inv_no_raw = data.get("invoice_no_date", "")
    clean_inv = "REF"
    import re
    if inv_no_raw:
        part = inv_no_raw.split("DT")[0].split("dt")[0].strip()
        if "/" in part:
            parts = part.split("/")
            if len(parts[0]) > 2:
                part = parts[0]
            else:
                part = parts[0] + parts[1]
        if "-" in part:
            subparts = part.split("-")
            if len(subparts[0]) > 2:
                part = subparts[0]
        clean_inv = re.sub(r'[^A-Za-z0-9]', '', part)
        
    bl_template = app.bl_template_var.get()
    if bl_template == "Cotton Home":
        bl_filename = f"COTTON_BL Instruction {clean_inv}.xlsx"
    elif bl_template == "PEMI":
        bl_filename = f"PEMI_BL Instruction {clean_inv}.xlsx"
    elif bl_template == "Sri Sakthi":
        bl_filename = f"SRI SAKTHI_BL Instruction {clean_inv}.xlsx"
    else:
        bl_filename = f"Generated_BL_Instructions_{clean_inv}.xlsx"
        
    print("bl_filename will be:", bl_filename)
    
    # Now call the actual generation methods
    out_path = os.path.join(dest_dir, bl_filename)
    print("Generating BL Instructions to:", out_path)
    
    # Let's populate the template_bl_path in data as generate_all does
    data["template_bl_path"] = os.path.abspath("BL INSTRUCTION CPS 001_template.xlsx")
    
    containers = []
    for r in app.container_rows:
        c_no = r["c_no_var"].get().strip()
        s_no = r["s_no_var"].get().strip()
        pkgs = r["pkgs_var"].get().strip()
        net = r["net_ent"].get().strip()
        gross = r["gross_ent"].get().strip()
        cbm = r["cbm_ent"].get().strip()
        containers.append({
            "container_no": c_no,
            "seal_no": s_no,
            "pkgs": pkgs,
            "net_wt": net,
            "gross_wt": gross,
            "cbm": cbm
        })
        
    app.generate_bl_instructions_file(data, containers, out_path)
    print("BL generation completed!")
    
    # Now check if file was created
    if os.path.exists(out_path):
        print("SUCCESS: File created:", out_path)
    else:
        print("FAIL: File not created!")

if __name__ == "__main__":
    test_cotton_generation()
