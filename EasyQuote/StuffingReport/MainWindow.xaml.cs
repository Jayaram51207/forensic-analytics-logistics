using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;
using ClosedXML.Excel;

namespace StuffingReport
{
    public partial class MainWindow : Window
    {
        public class ReportRow
        {
            public string ShipmentKey { get; set; } = "";
            public string ShipmentValue { get; set; } = "";
            public bool IsShipmentBlue { get; set; } = false;

            public string VesselKey { get; set; } = "";
            public string VesselValue { get; set; } = "";
            public bool IsVesselBlue { get; set; } = false;

            public bool IsEnabled { get; set; } = true;

            // UI references
            public CheckBox? RowCheckBox { get; set; }
            public TextBox? ShipmentKeyTextBox { get; set; }
            public TextBox? ShipmentValueTextBox { get; set; }
            public Button? ShipmentColorBtn { get; set; }

            public TextBox? VesselKeyTextBox { get; set; }
            public TextBox? VesselValueTextBox { get; set; }
            public Button? VesselColorBtn { get; set; }
        }

        private List<ReportRow> rowDefs = new List<ReportRow>();
        private bool isInitializing = true;

        public MainWindow()
        {
            InitializeComponent();
            InitializeData();
        }

        private void InitializeData()
        {
            isInitializing = true;

            GreetingTxt.Text = "Dear Sir,";
            SubGreetingTxt.Text = "Humble Greetings!";
            IntroNoteTxt.Text = "Please find the stuffing report given below for your kind reference.";
            RemarksTxt.Text = ""; // Blank by default, as shown in the image

            var defaultRows = new List<(string ShipKey, string ShipVal, bool ShipBlue, string VesselKey, string VesselVal, bool VesselBlue)>
            {
                ("Stuffing:", "12.06.2026", false, "", "", false),
                ("SHIPPER", "KANDASAMY TEXTILES", false, "FEEDER VESSEL", "INTERASIA HORIZON V.055", false),
                ("A/C", "LEADKING", false, "ETD KATTUPALLI", "", false),
                ("SHIPPING BILL NO", "4013089 / 10.06.2026", false, "ETA PORT KLANG", "20.06.2026", false),
                ("PACKAGES", "34", false, "EGM NO & DATE", "1196962 / 05.06.2026", false),
                ("GROSS WEIGHT", "918.00", false, "MOTHR VESSEL", "", true),
                ("CONTAINER NO.", "WHLU5593722/40'HC", false, "ETD.", "", true),
                ("", "", false, "ETA.DESTINATIONATION.", "", true),
                ("", "", false, "", "", false),
                ("", "", false, "", "", false),
                ("SEAL NO.", "OGS 5400", false, "", "", false),
                ("VOLUME", "3.660", false, "", "", false)
            };

            rowDefs.Clear();
            foreach (var r in defaultRows)
            {
                rowDefs.Add(new ReportRow
                {
                    ShipmentKey = r.ShipKey,
                    ShipmentValue = r.ShipVal,
                    IsShipmentBlue = r.ShipBlue,
                    VesselKey = r.VesselKey,
                    VesselValue = r.VesselVal,
                    IsVesselBlue = r.VesselBlue,
                    IsEnabled = true
                });
            }

            BuildGridWorkspace();
            isInitializing = false;
            UpdatePreview();
        }

        private void SaveCurrentValuesFromUI()
        {
            if (isInitializing) return;

            for (int i = 0; i < rowDefs.Count; i++)
            {
                var row = rowDefs[i];
                if (row.ShipmentKeyTextBox != null) row.ShipmentKey = row.ShipmentKeyTextBox.Text;
                if (row.ShipmentValueTextBox != null) row.ShipmentValue = row.ShipmentValueTextBox.Text;
                if (row.VesselKeyTextBox != null) row.VesselKey = row.VesselKeyTextBox.Text;
                if (row.VesselValueTextBox != null) row.VesselValue = row.VesselValueTextBox.Text;
            }
        }

        private void BuildGridWorkspace()
        {
            TableGrid.Children.Clear();
            TableGrid.ColumnDefinitions.Clear();
            TableGrid.RowDefinitions.Clear();

            // Set up column widths
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(45) });  // Col 0: Include Checkbox
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) }); // Col 1: Shipment Key
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) }); // Col 2: Shipment Value
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });  // Col 3: Shipment Color Toggle
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) }); // Col 4: Vessel Key
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) }); // Col 5: Vessel Value
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });  // Col 6: Vessel Color Toggle
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });  // Col 7: Delete Row Button

            // Header Row (Row 0)
            TableGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            AddGridHeader("Show", 0);
            AddGridHeader("Shipment Key", 1);
            AddGridHeader("Shipment Value", 2);
            AddGridHeader("Color", 3);
            AddGridHeader("Vessel Key", 4);
            AddGridHeader("Vessel Value", 5);
            AddGridHeader("Color", 6);
            AddGridHeader("Del", 7);

            // Data Rows (Rows 1+)
            for (int i = 0; i < rowDefs.Count; i++)
            {
                TableGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                var row = rowDefs[i];
                int gridRow = i + 1;

                // 0. Include CheckBox
                var chk = new CheckBox
                {
                    IsChecked = row.IsEnabled,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                };
                chk.Checked += (s, e) => { row.IsEnabled = true; OnDataChanged(); };
                chk.Unchecked += (s, e) => { row.IsEnabled = false; OnDataChanged(); };
                row.RowCheckBox = chk;
                Grid.SetRow(chk, gridRow);
                Grid.SetColumn(chk, 0);
                TableGrid.Children.Add(chk);

                // 1. Shipment Key TextBox
                var tbxShipKey = new TextBox
                {
                    Text = row.ShipmentKey,
                    Style = (Style)FindResource("GridTextBoxStyle"),
                    FontWeight = FontWeights.Bold
                };
                SetTextBoxColor(tbxShipKey, row.IsShipmentBlue);
                tbxShipKey.TextChanged += (s, e) => { row.ShipmentKey = tbxShipKey.Text; OnDataChanged(); };
                row.ShipmentKeyTextBox = tbxShipKey;
                Grid.SetRow(tbxShipKey, gridRow);
                Grid.SetColumn(tbxShipKey, 1);
                TableGrid.Children.Add(tbxShipKey);

                // 2. Shipment Value TextBox
                var tbxShipVal = new TextBox
                {
                    Text = row.ShipmentValue,
                    Style = (Style)FindResource("GridTextBoxStyle")
                };
                SetTextBoxColor(tbxShipVal, row.IsShipmentBlue);
                tbxShipVal.TextChanged += (s, e) => { row.ShipmentValue = tbxShipVal.Text; OnDataChanged(); };
                row.ShipmentValueTextBox = tbxShipVal;
                Grid.SetRow(tbxShipVal, gridRow);
                Grid.SetColumn(tbxShipVal, 2);
                TableGrid.Children.Add(tbxShipVal);

                // 3. Shipment Color Button
                var btnShipColor = new Button
                {
                    Content = row.IsShipmentBlue ? "🟦" : "⬛",
                    ToolTip = "Toggle text color (Black / Blue)",
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    FontSize = 12,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                };
                btnShipColor.Click += (s, e) =>
                {
                    SaveCurrentValuesFromUI();
                    row.IsShipmentBlue = !row.IsShipmentBlue;
                    BuildGridWorkspace();
                    UpdatePreview();
                };
                row.ShipmentColorBtn = btnShipColor;
                Grid.SetRow(btnShipColor, gridRow);
                Grid.SetColumn(btnShipColor, 3);
                TableGrid.Children.Add(btnShipColor);

                // 4. Vessel Key TextBox
                var tbxVesselKey = new TextBox
                {
                    Text = row.VesselKey,
                    Style = (Style)FindResource("GridTextBoxStyle"),
                    FontWeight = FontWeights.Bold
                };
                SetTextBoxColor(tbxVesselKey, row.IsVesselBlue);
                tbxVesselKey.TextChanged += (s, e) => { row.VesselKey = tbxVesselKey.Text; OnDataChanged(); };
                row.VesselKeyTextBox = tbxVesselKey;
                Grid.SetRow(tbxVesselKey, gridRow);
                Grid.SetColumn(tbxVesselKey, 4);
                TableGrid.Children.Add(tbxVesselKey);

                // 5. Vessel Value TextBox
                var tbxVesselVal = new TextBox
                {
                    Text = row.VesselValue,
                    Style = (Style)FindResource("GridTextBoxStyle")
                };
                SetTextBoxColor(tbxVesselVal, row.IsVesselBlue);
                tbxVesselVal.TextChanged += (s, e) => { row.VesselValue = tbxVesselVal.Text; OnDataChanged(); };
                row.VesselValueTextBox = tbxVesselVal;
                Grid.SetRow(tbxVesselVal, gridRow);
                Grid.SetColumn(tbxVesselVal, 5);
                TableGrid.Children.Add(tbxVesselVal);

                // 6. Vessel Color Button
                var btnVesselColor = new Button
                {
                    Content = row.IsVesselBlue ? "🟦" : "⬛",
                    ToolTip = "Toggle text color (Black / Blue)",
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    FontSize = 12,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                };
                btnVesselColor.Click += (s, e) =>
                {
                    SaveCurrentValuesFromUI();
                    row.IsVesselBlue = !row.IsVesselBlue;
                    BuildGridWorkspace();
                    UpdatePreview();
                };
                row.VesselColorBtn = btnVesselColor;
                Grid.SetRow(btnVesselColor, gridRow);
                Grid.SetColumn(btnVesselColor, 6);
                TableGrid.Children.Add(btnVesselColor);

                // 7. Delete Row Button
                var btnDelete = new Button
                {
                    Content = "❌",
                    ToolTip = "Delete this row",
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    FontSize = 10,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                };
                int localIdx = i;
                btnDelete.Click += (s, e) =>
                {
                    var result = MessageBox.Show("Are you sure you want to delete this row?", "Confirm Delete Row", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                    if (result == MessageBoxResult.Yes)
                    {
                        DeleteRow(localIdx);
                    }
                };
                Grid.SetRow(btnDelete, gridRow);
                Grid.SetColumn(btnDelete, 7);
                TableGrid.Children.Add(btnDelete);
            }
        }

        private void AddGridHeader(string text, int colIdx)
        {
            var border = new Border
            {
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E293B")),
                BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#94A3B8")),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(4, 6, 4, 6)
            };
            var textBlock = new TextBlock
            {
                Text = text,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                FontSize = 11,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Center
            };
            border.Child = textBlock;
            Grid.SetRow(border, 0);
            Grid.SetColumn(border, colIdx);
            TableGrid.Children.Add(border);
        }

        private void SetTextBoxColor(TextBox tbx, bool isBlue)
        {
            tbx.Foreground = isBlue 
                ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1B4E8C")) 
                : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#334155"));
        }

        private void DeleteRow(int index)
        {
            if (index >= 0 && index < rowDefs.Count)
            {
                SaveCurrentValuesFromUI();
                rowDefs.RemoveAt(index);
                BuildGridWorkspace();
                UpdatePreview();
                StatusTxt.Text = "Row deleted.";
            }
        }

        private void AddRowBtn_Click(object sender, RoutedEventArgs e)
        {
            SaveCurrentValuesFromUI();
            rowDefs.Add(new ReportRow
            {
                ShipmentKey = "",
                ShipmentValue = "",
                VesselKey = "",
                VesselValue = "",
                IsEnabled = true
            });
            BuildGridWorkspace();
            UpdatePreview();
            StatusTxt.Text = "New row added at the bottom.";
        }

        private void OnDataChanged()
        {
            if (isInitializing) return;
            UpdatePreview();
        }

        private void Detail_TextChanged(object sender, TextChangedEventArgs e)
        {
            OnDataChanged();
        }

        private void UpdatePreview()
        {
            try
            {
                string html = GenerateHtmlTable();
                
                string fullDocument = $@"
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset='utf-8'/>
                    <style>
                        body {{
                            margin: 15px;
                            padding: 0;
                            background-color: #ffffff;
                            font-family: Calibri, Arial, sans-serif;
                            font-size: 14px;
                        }}
                    </style>
                </head>
                <body>
                    {html}
                </body>
                </html>";

                PreviewBrowser.NavigateToString(fullDocument);
                StatusTxt.Text = "Preview updated.";
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Error updating preview: " + ex.Message;
            }
        }

        private string GenerateHtmlTable()
        {
            string greeting = GreetingTxt.Text;
            string subGreeting = SubGreetingTxt.Text;
            string intro = IntroNoteTxt.Text;
            string remarks = RemarksTxt.Text;

            var sb = new StringBuilder();

            sb.Append("<div style=\"font-family: 'Calibri', 'Arial', sans-serif; font-size: 14px; color: #000000; line-height: 1.4; max-width: 900px;\">");

            if (!string.IsNullOrWhiteSpace(greeting))
            {
                sb.Append($"<p style=\"margin: 0 0 4px 0;\">{HtmlEncode(greeting)}</p>");
            }
            if (!string.IsNullOrWhiteSpace(subGreeting))
            {
                sb.Append($"<p style=\"margin: 0 0 12px 0;\">{HtmlEncode(subGreeting)}</p>");
            }
            if (!string.IsNullOrWhiteSpace(intro))
            {
                sb.Append($"<p style=\"margin: 0 0 16px 0;\">{HtmlEncode(intro)}</p>");
            }

            // Title block
            sb.Append("<div style=\"text-align: center; font-weight: bold; font-size: 15px; margin-bottom: 12px; border-top: 1px solid #000000; border-bottom: 2px solid #000000; padding: 6px 0; letter-spacing: 0.5px;\">");
            sb.Append("STUFFING REPORT WITH TENTATIVE VESSEL SCHEDULE");
            sb.Append("</div>");

            // Main Table
            sb.Append("<table style=\"border-collapse: collapse; width: 100%; font-family: 'Calibri', 'Arial', sans-serif; font-size: 13px; border: 1.5px solid #000000;\">");

            // Table Headers
            sb.Append("<thead>");
            sb.Append("<tr style=\"border-bottom: 1px solid #000000;\">");
            sb.Append("<th colspan=\"2\" style=\"border-right: 1px solid #000000; padding: 8px; text-align: center; font-weight: bold; font-size: 13px;\">SHIPMENT DETAILS</th>");
            sb.Append("<th colspan=\"2\" style=\"border-right: 1px solid #000000; padding: 8px; text-align: center; font-weight: bold; font-size: 13px;\">TENTATIVE VESSEL SCHEDULE</th>");
            sb.Append("<th style=\"padding: 8px; text-align: center; font-weight: bold; font-size: 13px; color: #1B4E8C;\">REMARKS</th>");
            sb.Append("</tr>");
            sb.Append("</thead>");

            sb.Append("<tbody>");

            // Filter enabled rows
            var activeRows = new List<ReportRow>();
            foreach (var r in rowDefs)
            {
                if (r.IsEnabled) activeRows.Add(r);
            }

            int totalActive = activeRows.Count;

            for (int idx = 0; idx < totalActive; idx++)
            {
                var row = activeRows[idx];
                sb.Append("<tr style=\"border-bottom: 1px solid #000000;\">");

                // --- 1. Shipment Side (Key & Value) ---
                bool hasShipVal = !string.IsNullOrWhiteSpace(row.ShipmentValue);
                bool hasShipKey = !string.IsNullOrWhiteSpace(row.ShipmentKey);
                string shipColor = row.IsShipmentBlue ? "color: #1B4E8C;" : "color: #000000;";

                if (hasShipKey && !hasShipVal)
                {
                    // Merged shipment cell
                    sb.Append($"<td colspan=\"2\" style=\"border-right: 1px solid #000000; padding: 6px 8px; text-align: left; font-weight: bold; {shipColor}\">{HtmlEncode(row.ShipmentKey)}</td>");
                }
                else if (!hasShipKey && !hasShipVal)
                {
                    // Empty cell
                    sb.Append("<td colspan=\"2\" style=\"border-right: 1px solid #000000; padding: 6px 8px;\">&nbsp;</td>");
                }
                else
                {
                    // Normal Key + Value
                    sb.Append($"<td style=\"width: 20%; border-right: 1px solid #000000; padding: 6px 8px; text-align: left; font-weight: bold; {shipColor}\">{HtmlEncode(row.ShipmentKey)}</td>");
                    sb.Append($"<td style=\"width: 25%; border-right: 1px solid #000000; padding: 6px 8px; text-align: left; {shipColor}\">{HtmlEncode(row.ShipmentValue)}</td>");
                }

                // --- 2. Vessel Side (Key & Value) ---
                bool hasVesselVal = !string.IsNullOrWhiteSpace(row.VesselValue);
                bool hasVesselKey = !string.IsNullOrWhiteSpace(row.VesselKey);
                string vesselColor = row.IsVesselBlue ? "color: #1B4E8C;" : "color: #000000;";

                if (hasVesselKey && !hasVesselVal)
                {
                    // Merged vessel cell
                    sb.Append($"<td colspan=\"2\" style=\"border-right: 1px solid #000000; padding: 6px 8px; text-align: left; font-weight: bold; {vesselColor}\">{HtmlEncode(row.VesselKey)}</td>");
                }
                else if (!hasVesselKey && !hasVesselVal)
                {
                    // Empty cell
                    sb.Append("<td colspan=\"2\" style=\"border-right: 1px solid #000000; padding: 6px 8px;\">&nbsp;</td>");
                }
                else
                {
                    // Normal Key + Value
                    sb.Append($"<td style=\"width: 20%; border-right: 1px solid #000000; padding: 6px 8px; text-align: left; font-weight: bold; {vesselColor}\">{HtmlEncode(row.VesselKey)}</td>");
                    sb.Append($"<td style=\"width: 25%; border-right: 1px solid #000000; padding: 6px 8px; text-align: left; {vesselColor}\">{HtmlEncode(row.VesselValue)}</td>");
                }

                // --- 3. Remarks Column (Rowspan on first row) ---
                if (idx == 0)
                {
                    string formattedRemarks = FormatRemarksForHtml(remarks);
                    sb.Append($"<td rowspan=\"{totalActive}\" style=\"width: 10%; padding: 8px; text-align: left; vertical-align: top; font-size: 13px; font-weight: normal; color: #334155;\">{formattedRemarks}</td>");
                }

                sb.Append("</tr>");
            }

            sb.Append("</tbody>");
            sb.Append("</table>");
            sb.Append("</div>");

            return sb.ToString();
        }

        private string GeneratePlainText()
        {
            var sb = new StringBuilder();

            if (!string.IsNullOrWhiteSpace(GreetingTxt.Text)) sb.AppendLine(GreetingTxt.Text);
            if (!string.IsNullOrWhiteSpace(SubGreetingTxt.Text)) sb.AppendLine(SubGreetingTxt.Text);
            if (!string.IsNullOrWhiteSpace(IntroNoteTxt.Text)) sb.AppendLine(IntroNoteTxt.Text);
            sb.AppendLine();
            sb.AppendLine("STUFFING REPORT WITH TENTATIVE VESSEL SCHEDULE");
            sb.AppendLine(new string('=', 90));

            // Format simple ASCII columns
            int kWidth = 20;
            int vWidth = 22;

            sb.AppendLine(string.Format("{0,-42} | {1,-42} | {2}", "SHIPMENT DETAILS", "TENTATIVE VESSEL SCHEDULE", "REMARKS"));
            sb.AppendLine(new string('-', 90));

            var activeRows = new List<ReportRow>();
            foreach (var r in rowDefs)
            {
                if (r.IsEnabled) activeRows.Add(r);
            }

            string[] remarkLines = RemarksTxt.Text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);

            for (int idx = 0; idx < activeRows.Count; idx++)
            {
                var row = activeRows[idx];

                // Shipment cell content
                string shipCell = "";
                if (!string.IsNullOrWhiteSpace(row.ShipmentKey) && string.IsNullOrWhiteSpace(row.ShipmentValue))
                {
                    shipCell = row.ShipmentKey.PadRight(kWidth + vWidth + 1);
                }
                else
                {
                    shipCell = string.Format("{0,-20} {1,-22}", row.ShipmentKey, row.ShipmentValue);
                }

                // Vessel cell content
                string vesselCell = "";
                if (!string.IsNullOrWhiteSpace(row.VesselKey) && string.IsNullOrWhiteSpace(row.VesselValue))
                {
                    vesselCell = row.VesselKey.PadRight(kWidth + vWidth + 1);
                }
                else
                {
                    vesselCell = string.Format("{0,-20} {1,-22}", row.VesselKey, row.VesselValue);
                }

                // Remarks line content
                string remarkLine = idx < remarkLines.Length ? remarkLines[idx] : "";

                sb.AppendLine(string.Format("{0} | {1} | {2}", shipCell, vesselCell, remarkLine));
            }

            // Print rest of remarks if there are more lines
            if (remarkLines.Length > activeRows.Count)
            {
                for (int idx = activeRows.Count; idx < remarkLines.Length; idx++)
                {
                    sb.AppendLine(string.Format("{0,-42} | {1,-42} | {2}", "", "", remarkLines[idx]));
                }
            }

            return sb.ToString();
        }

        private void CopyHtmlBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                SaveCurrentValuesFromUI();
                string html = GenerateHtmlTable();
                
                string startHtml = "<html>\r\n<body>\r\n<!--StartFragment-->";
                string endHtml = "<!--EndFragment-->\r\n</body>\r\n</html>";

                string headerTemplate =
                    "Version:0.9\r\n" +
                    "StartHTML:0000000000\r\n" +
                    "EndHTML:0000000000\r\n" +
                    "StartFragment:0000000000\r\n" +
                    "EndFragment:0000000000\r\n";

                byte[] headerBytes = Encoding.UTF8.GetBytes(headerTemplate);
                byte[] startHtmlBytes = Encoding.UTF8.GetBytes(startHtml);
                byte[] htmlBytes = Encoding.UTF8.GetBytes(html);
                byte[] endHtmlBytes = Encoding.UTF8.GetBytes(endHtml);

                int headerLength = headerBytes.Length;
                int startHtmlOffset = headerLength;
                int startFragmentOffset = startHtmlOffset + startHtmlBytes.Length;
                int endFragmentOffset = startFragmentOffset + htmlBytes.Length;
                int endHtmlOffset = endFragmentOffset + endHtmlBytes.Length;

                string finalHeader = 
                    "Version:0.9\r\n" +
                    $"StartHTML:{startHtmlOffset:D10}\r\n" +
                    $"EndHTML:{endHtmlOffset:D10}\r\n" +
                    $"StartFragment:{startFragmentOffset:D10}\r\n" +
                    $"EndFragment:{endFragmentOffset:D10}\r\n";

                byte[] finalHeaderBytes = Encoding.UTF8.GetBytes(finalHeader);
                
                byte[] totalBytes = new byte[finalHeaderBytes.Length + startHtmlBytes.Length + htmlBytes.Length + endHtmlBytes.Length];
                Buffer.BlockCopy(finalHeaderBytes, 0, totalBytes, 0, finalHeaderBytes.Length);
                Buffer.BlockCopy(startHtmlBytes, 0, totalBytes, finalHeaderBytes.Length, startHtmlBytes.Length);
                Buffer.BlockCopy(htmlBytes, 0, totalBytes, finalHeaderBytes.Length + startHtmlBytes.Length, htmlBytes.Length);
                Buffer.BlockCopy(endHtmlBytes, 0, totalBytes, finalHeaderBytes.Length + startHtmlBytes.Length + htmlBytes.Length, endHtmlBytes.Length);

                using (var ms = new MemoryStream(totalBytes))
                {
                    DataObject dataObject = new DataObject();
                    dataObject.SetData("HTML Format", ms);
                    dataObject.SetText(html, TextDataFormat.UnicodeText);
                    Clipboard.SetDataObject(dataObject, true);
                }

                StatusTxt.Text = "HTML Table copied to Clipboard!";
                MessageBox.Show("HTML Table copied to Clipboard!\n\nYou can now paste it directly into Outlook, Gmail, or Word with formatting preserved.", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Failed to copy HTML: " + ex.Message;
                MessageBox.Show("Failed to copy table: " + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void CopyTextBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                SaveCurrentValuesFromUI();
                string txt = GeneratePlainText();
                Clipboard.SetText(txt, TextDataFormat.UnicodeText);
                StatusTxt.Text = "Plain Text copied to Clipboard!";
                MessageBox.Show("Plain Text copied to Clipboard!", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Failed to copy text: " + ex.Message;
                MessageBox.Show("Failed to copy plain text: " + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void SaveHtmlFileBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                SaveCurrentValuesFromUI();
                var sfd = new SaveFileDialog
                {
                    Filter = "HTML Files (*.html;*.htm)|*.html;*.htm|All Files (*.*)|*.*",
                    FileName = "Stuffing_Report.html",
                    Title = "Export Stuffing Report to HTML File"
                };

                if (sfd.ShowDialog() == true)
                {
                    string html = GenerateHtmlTable();
                    string fullHtml = $@"<!DOCTYPE html>
<html>
<head>
    <meta charset=""utf-8"">
    <title>Stuffing Report</title>
    <style>
        body {{
            padding: 30px;
            background-color: #f8fafc;
            font-family: Calibri, Arial, sans-serif;
        }}
        .card {{
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            max-width: 900px;
            margin: 0 auto;
        }}
    </style>
</head>
<body>
    <div class=""card"">
        {html}
    </div>
</body>
</html>";
                    File.WriteAllText(sfd.FileName, fullHtml, Encoding.UTF8);
                    StatusTxt.Text = $"Exported HTML to {Path.GetFileName(sfd.FileName)}.";
                    MessageBox.Show("Stuffing Report HTML file exported successfully!", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Failed to save HTML file: " + ex.Message;
                MessageBox.Show("Failed to export HTML file: " + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void ExportExcelBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                SaveCurrentValuesFromUI();
                var sfd = new SaveFileDialog
                {
                    Filter = "Excel Workbooks (*.xlsx)|*.xlsx|All Files (*.*)|*.*",
                    FileName = "Stuffing_Report_Schedule.xlsx",
                    Title = "Export Stuffing Report to Excel"
                };

                if (sfd.ShowDialog() == true)
                {
                    GenerateExcelWorkbook(sfd.FileName);
                    StatusTxt.Text = $"Exported Excel to {Path.GetFileName(sfd.FileName)}.";
                    MessageBox.Show("Excel file exported successfully!", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Failed to save Excel file: " + ex.Message;
                MessageBox.Show("Failed to export Excel file: " + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void GenerateExcelWorkbook(string filePath)
        {
            using (var workbook = new XLWorkbook())
            {
                var ws = workbook.Worksheets.Add("Stuffing Report");

                ws.Style.Font.FontName = "Calibri";
                ws.Style.Font.FontSize = 11;

                // Set grid lines visible
                ws.ShowGridLines = true;

                int currentRow = 2;

                // 1. Write Greeting Info
                if (!string.IsNullOrWhiteSpace(GreetingTxt.Text))
                {
                    ws.Cell(currentRow, 1).Value = GreetingTxt.Text;
                    currentRow++;
                }
                if (!string.IsNullOrWhiteSpace(SubGreetingTxt.Text))
                {
                    ws.Cell(currentRow, 1).Value = SubGreetingTxt.Text;
                    currentRow++;
                }
                if (!string.IsNullOrWhiteSpace(IntroNoteTxt.Text))
                {
                    ws.Cell(currentRow, 1).Value = IntroNoteTxt.Text;
                    currentRow++;
                }

                currentRow += 1;

                // 2. Report Title
                var titleCell = ws.Cell(currentRow, 1);
                titleCell.Value = "STUFFING REPORT WITH TENTATIVE VESSEL SCHEDULE";
                titleCell.Style.Font.Bold = true;
                titleCell.Style.Font.FontSize = 13;
                titleCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                ws.Range(currentRow, 1, currentRow, 5).Merge();
                ws.Cell(currentRow, 1).Style.Border.TopBorder = XLBorderStyleValues.Thin;
                ws.Cell(currentRow, 1).Style.Border.BottomBorder = XLBorderStyleValues.Medium;
                
                currentRow += 2;

                // 3. Table Headers
                int tableStartRow = currentRow;

                // SHIPMENT DETAILS (Merged Cols A & B)
                var hShip = ws.Cell(currentRow, 1);
                hShip.Value = "SHIPMENT DETAILS";
                hShip.Style.Font.Bold = true;
                hShip.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                hShip.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                ws.Range(currentRow, 1, currentRow, 2).Merge();

                // TENTATIVE VESSEL SCHEDULE (Merged Cols C & D)
                var hVess = ws.Cell(currentRow, 3);
                hVess.Value = "TENTATIVE VESSEL SCHEDULE";
                hVess.Style.Font.Bold = true;
                hVess.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                hVess.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                ws.Range(currentRow, 3, currentRow, 4).Merge();

                // REMARKS (Col E)
                var hRem = ws.Cell(currentRow, 5);
                hRem.Value = "REMARKS";
                hRem.Style.Font.Bold = true;
                hRem.Style.Font.FontColor = XLColor.FromHtml("#1B4E8C");
                hRem.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                hRem.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;

                currentRow++;

                // 4. Data Rows
                var activeRows = new List<ReportRow>();
                foreach (var r in rowDefs)
                {
                    if (r.IsEnabled) activeRows.Add(r);
                }

                int totalActive = activeRows.Count;

                for (int idx = 0; idx < totalActive; idx++)
                {
                    var row = activeRows[idx];

                    // Shipment block
                    bool hasShipVal = !string.IsNullOrWhiteSpace(row.ShipmentValue);
                    bool hasShipKey = !string.IsNullOrWhiteSpace(row.ShipmentKey);
                    var shipColor = row.IsShipmentBlue ? XLColor.FromHtml("#1B4E8C") : XLColor.Black;

                    if (hasShipKey && !hasShipVal)
                    {
                        var cell = ws.Cell(currentRow, 1);
                        cell.Value = row.ShipmentKey;
                        cell.Style.Font.Bold = true;
                        cell.Style.Font.FontColor = shipColor;
                        ws.Range(currentRow, 1, currentRow, 2).Merge();
                    }
                    else if (hasShipKey || hasShipVal)
                    {
                        var kCell = ws.Cell(currentRow, 1);
                        kCell.Value = row.ShipmentKey;
                        kCell.Style.Font.Bold = true;
                        kCell.Style.Font.FontColor = shipColor;

                        var vCell = ws.Cell(currentRow, 2);
                        vCell.Value = row.ShipmentValue;
                        vCell.Style.Font.FontColor = shipColor;
                    }

                    // Vessel block
                    bool hasVesselVal = !string.IsNullOrWhiteSpace(row.VesselValue);
                    bool hasVesselKey = !string.IsNullOrWhiteSpace(row.VesselKey);
                    var vesselColor = row.IsVesselBlue ? XLColor.FromHtml("#1B4E8C") : XLColor.Black;

                    if (hasVesselKey && !hasVesselVal)
                    {
                        var cell = ws.Cell(currentRow, 3);
                        cell.Value = row.VesselKey;
                        cell.Style.Font.Bold = true;
                        cell.Style.Font.FontColor = vesselColor;
                        ws.Range(currentRow, 3, currentRow, 4).Merge();
                    }
                    else if (hasVesselKey || hasVesselVal)
                    {
                        var kCell = ws.Cell(currentRow, 3);
                        kCell.Value = row.VesselKey;
                        kCell.Style.Font.Bold = true;
                        kCell.Style.Font.FontColor = vesselColor;

                        var vCell = ws.Cell(currentRow, 4);
                        vCell.Value = row.VesselValue;
                        vCell.Style.Font.FontColor = vesselColor;
                    }

                    // Add thin gridlines border inside the table cells
                    ws.Range(currentRow, 1, currentRow, 4).Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                    ws.Range(currentRow, 1, currentRow, 4).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;

                    currentRow++;
                }

                int tableEndRow = currentRow - 1;

                // Merged Remarks Column E
                if (totalActive > 0)
                {
                    var remarksRange = ws.Range(tableStartRow + 1, 5, tableEndRow, 5);
                    remarksRange.Merge();
                    var cell = ws.Cell(tableStartRow + 1, 5);
                    cell.Value = RemarksTxt.Text;
                    cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                    cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
                    cell.Style.Alignment.WrapText = true;
                    remarksRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                }
                else
                {
                    // No rows, remarks is just empty
                    ws.Cell(tableStartRow + 1, 5).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                }

                // Apply medium outer border around the whole table
                var tableRange = ws.Range(tableStartRow, 1, tableEndRow, 5);
                tableRange.Style.Border.OutsideBorder = XLBorderStyleValues.Medium;

                // 5. Autofit columns
                ws.Columns(1, 4).AdjustToContents();
                ws.Column(5).Width = 35; // Fixed wider column for Remarks

                workbook.SaveAs(filePath);
            }
        }

        private void ResetBtn_Click(object sender, RoutedEventArgs e)
        {
            var result = MessageBox.Show("Are you sure you want to reset all details to defaults?", "Confirm Reset", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (result == MessageBoxResult.Yes)
            {
                InitializeData();
                StatusTxt.Text = "Reset defaults completed.";
            }
        }

        private void SelectAllRows_Click(object sender, RoutedEventArgs e)
        {
            isInitializing = true;
            foreach (var row in rowDefs)
            {
                row.IsEnabled = true;
                if (row.RowCheckBox != null) row.RowCheckBox.IsChecked = true;
            }
            isInitializing = false;
            BuildGridWorkspace();
            UpdatePreview();
            StatusTxt.Text = "All rows selected.";
        }

        private void DeselectAllRows_Click(object sender, RoutedEventArgs e)
        {
            isInitializing = true;
            foreach (var row in rowDefs)
            {
                row.IsEnabled = false;
                if (row.RowCheckBox != null) row.RowCheckBox.IsChecked = false;
            }
            isInitializing = false;
            BuildGridWorkspace();
            UpdatePreview();
            StatusTxt.Text = "All rows deselected.";
        }

        private static string HtmlEncode(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            return text.Replace("&", "&amp;")
                       .Replace("<", "&lt;")
                       .Replace(">", "&gt;")
                       .Replace("\"", "&quot;")
                       .Replace("'", "&#39;");
        }

        private static string FormatRemarksForHtml(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            return HtmlEncode(text).Replace("\r\n", "<br/>").Replace("\n", "<br/>");
        }
    }
}
