using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;
using ClosedXML.Excel;

namespace EasyQuote
{
    public partial class MainWindow : Window
    {
        // Data models for columns and rows
        public class ColumnDef
        {
            public string Header { get; set; } = "";
            public bool IsEnabled { get; set; } = true;
            public bool IsChennai { get; set; } = true;
            public CheckBox? HeaderCheckBox { get; set; }
            public TextBox? HeaderTextBox { get; set; }
        }

        public class RowDef
        {
            public string Header { get; set; } = "";
            public bool IsEnabled { get; set; } = true;
            public List<string> DefaultValues { get; set; } = new List<string>();
            public List<string> CurrentValues { get; set; } = new List<string>();
            public CheckBox? RowCheckBox { get; set; }
            public TextBox? HeaderTextBox { get; set; }
            public List<TextBox> ValueTextBoxes { get; set; } = new List<TextBox>();
        }

        private List<ColumnDef> columnDefs = new List<ColumnDef>();
        private List<RowDef> rowDefs = new List<RowDef>();
        private bool isInitializing = true;

        public MainWindow()
        {
            InitializeComponent();
            InitializeData();
        }

        private void InitializeData()
        {
            isInitializing = true;

            // Define initial columns
            columnDefs = new List<ColumnDef>
            {
                new ColumnDef { Header = "Chennai - LCL", IsEnabled = true, IsChennai = true },
                new ColumnDef { Header = "Chennai - 20ft", IsEnabled = true, IsChennai = true },
                new ColumnDef { Header = "Chennai - 40ft", IsEnabled = true, IsChennai = true },
                new ColumnDef { Header = "Tuti. LCL", IsEnabled = true, IsChennai = false },
                new ColumnDef { Header = "Tuti. 20ft", IsEnabled = true, IsChennai = false },
                new ColumnDef { Header = "Tuti. 40ft", IsEnabled = true, IsChennai = false }
            };

            // Define initial rows and load their default/current values
            var initialRows = new List<(string Name, string[] Values)>
            {
                ("Documentation", new string[] { "Rs.1000/- per Bill", "Rs.1000/- per Bill", "Rs.1000/- per Bill", "Rs.1000/- per Bill", "Rs.1000/- per Bill", "Rs.1000/- per Bill" }),
                ("CFS Charges", new string[] { "AT ACTUALS", "AT ACTUALS", "AT ACTUALS", "AT ACTUALS", "AT ACTUALS", "AT ACTUALS" }),
                ("Container Transportation Charges", new string[] { "N.A.", "Rs.9500/- per 20ft", "Rs.10500/- per 40ft", "N.A.", "Rs.9500/- per 20ft", "Rs.10500/- per 40ft" }),
                ("Loading into container", new string[] { "N.A.", "Rs.750/- per 20ft", "Rs.1200/- per 40ft", "N.A.", "Rs.750/- per 20ft", "Rs.1200/- per 40ft" }),
                ("Handling Charges", new string[] { "Rs.1000/- per Bill", "Rs.2000/- per 20ft", "Rs.3000/- per 40ft", "Rs.1000/- per Bill", "Rs.3000/- per 20ft", "Rs.4000/- per 40ft" }),
                ("Survey Charges", new string[] { "N.A.", "Rs.850/- per 20ft", "Rs.950/- per 40ft", "N.A.", "Rs.1250/- per 20ft", "Rs.1400/- per 40ft" }),
                ("Service Charges", new string[] { "Rs.1620/- per Bill", "Rs.2610/- per 20ft", "Rs.3000/- per 40ft", "Rs.1620/- per Bill", "Rs.2610/- per 20ft", "Rs.3000/- per 40ft" }),
                ("Country of Origin", new string[] { "Rs.500/- per Inv.", "Rs.500/- per Inv.", "Rs.500/- per Inv.", "Rs.500/- per Inv.", "Rs.500/- per Inv.", "Rs.500/- per Inv." }),
                ("Fumigation Charges", new string[] { "Will advise", "Will advise", "Will advise", "Will advise", "Will advise", "Will advise" }),
                ("VGM/Form13/Transshipment", new string[] { "N.A.", "Rs.1300/- per 20ft", "Rs.1300/- per 40ft", "N.A.", "Rs.1300/- per 20ft", "Rs.1300/- per 20ft" }),
                ("Cargo movement from factory to CFS & Unloading Charges", new string[] { "Shippers scope", "Shippers scope", "Shippers scope", "Shippers scope", "Shippers scope", "Shippers scope" })
            };

            rowDefs.Clear();
            foreach (var r in initialRows)
            {
                var rowDef = new RowDef
                {
                    Header = r.Name,
                    DefaultValues = new List<string>(r.Values),
                    CurrentValues = new List<string>(r.Values),
                    IsEnabled = true
                };
                rowDefs.Add(rowDef);
            }

            BuildGridWorkspace();
            isInitializing = false;
            UpdatePreview();
        }

        /// <summary>
        /// Saves all edited text and header values from the active UI text boxes back into data arrays 
        /// so they are not lost when rebuilding the layout.
        /// </summary>
        private void SaveCurrentValuesFromUI()
        {
            if (isInitializing) return;

            // Save column headers
            for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
            {
                var col = columnDefs[colIdx];
                if (col.HeaderTextBox != null)
                {
                    col.Header = col.HeaderTextBox.Text;
                }
            }

            // Save row headers & cell values
            for (int rowIdx = 0; rowIdx < rowDefs.Count; rowIdx++)
            {
                var row = rowDefs[rowIdx];
                if (row.HeaderTextBox != null)
                {
                    row.Header = row.HeaderTextBox.Text;
                }

                for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
                {
                    if (colIdx < row.ValueTextBoxes.Count && row.ValueTextBoxes[colIdx] != null)
                    {
                        if (colIdx < row.CurrentValues.Count)
                        {
                            row.CurrentValues[colIdx] = row.ValueTextBoxes[colIdx].Text;
                        }
                        else
                        {
                            row.CurrentValues.Add(row.ValueTextBoxes[colIdx].Text);
                        }
                    }
                }
            }
        }

        /// <summary>
        /// Dynamically creates the WPF Grid columns, rows, and editable UI text boxes.
        /// </summary>
        private void BuildGridWorkspace()
        {
            TableGrid.Children.Clear();
            TableGrid.ColumnDefinitions.Clear();
            TableGrid.RowDefinitions.Clear();

            // 1. Column definitions: 1 for Row Header + N for columns
            TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(300) });
            for (int i = 0; i < columnDefs.Count; i++)
            {
                TableGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
            }

            // 2. Row definitions: 1 for Column controls (Row 0), 1 for Headers (Row 1), M for values
            TableGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Row 0: Column Controls
            TableGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Row 1: Column Headers
            for (int i = 0; i < rowDefs.Count; i++)
            {
                TableGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Row 2+: Data rows
            }

            // --- Row 0: Column Controls (Include, Color Theme, Delete) ---
            for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
            {
                var col = columnDefs[colIdx];
                int colGridPos = colIdx + 1;

                var controlPanel = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 8, 0, 4)
                };

                // 1. Include checkbox
                var chk = new CheckBox
                {
                    Content = "Show",
                    IsChecked = col.IsEnabled,
                    Margin = new Thickness(0, 0, 8, 0),
                    FontWeight = FontWeights.Medium,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#475569"))
                };
                chk.Checked += (s, e) => { col.IsEnabled = true; OnDataChanged(); };
                chk.Unchecked += (s, e) => { col.IsEnabled = false; OnDataChanged(); };
                col.HeaderCheckBox = chk;
                controlPanel.Children.Add(chk);

                // 2. Theme color toggle button
                string colorIcon = col.IsChennai ? "🟢" : "🔵";
                string themeTooltip = col.IsChennai ? "Style: Green Theme (Chennai). Click to change to Blue." : "Style: Blue Theme (Tuti.). Click to change to Green.";
                var themeBtn = new Button
                {
                    Content = colorIcon,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    ToolTip = themeTooltip,
                    Margin = new Thickness(0, 0, 6, 0),
                    FontSize = 12
                };
                themeBtn.Click += (s, e) =>
                {
                    SaveCurrentValuesFromUI();
                    col.IsChennai = !col.IsChennai;
                    BuildGridWorkspace();
                    UpdatePreview();
                };
                controlPanel.Children.Add(themeBtn);

                // 3. Delete column button
                var deleteBtn = new Button
                {
                    Content = "❌",
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    ToolTip = "Delete this column",
                    FontSize = 10
                };
                deleteBtn.Click += (s, e) =>
                {
                    var result = MessageBox.Show($"Are you sure you want to delete column '{col.Header}'?", "Confirm Delete Column", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                    if (result == MessageBoxResult.Yes)
                    {
                        DeleteColumn(colIdx);
                    }
                };
                controlPanel.Children.Add(deleteBtn);

                Grid.SetRow(controlPanel, 0);
                Grid.SetColumn(controlPanel, colGridPos);
                TableGrid.Children.Add(controlPanel);
            }

            // --- Row 1: Column Header Labels (Editable) ---
            // Top-left header cell "Charges Description"
            var descHeaderBorder = new Border
            {
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E293B")),
                BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#94A3B8")),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 10, 8, 10)
            };
            var descHeaderText = new TextBlock
            {
                Text = "Charges Description",
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                VerticalAlignment = VerticalAlignment.Center
            };
            descHeaderBorder.Child = descHeaderText;
            Grid.SetRow(descHeaderBorder, 1);
            Grid.SetColumn(descHeaderBorder, 0);
            TableGrid.Children.Add(descHeaderBorder);

            // Port Column headers (now as TextBoxes for editing!)
            for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
            {
                var col = columnDefs[colIdx];
                int colGridPos = colIdx + 1;
                string bgColorStr = col.IsChennai ? "#E2F0D9" : "#DDEBF7";
                string fgColorStr = col.IsChennai ? "#1E5622" : "#1A4384";
                string borderColorStr = col.IsChennai ? "#C2D9B9" : "#B9D2E8";

                var border = new Border
                {
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(bgColorStr)),
                    BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(borderColorStr)),
                    BorderThickness = new Thickness(0, 1, 1, 1),
                    Padding = new Thickness(4)
                };

                var headerTbx = new TextBox
                {
                    Text = col.Header,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(fgColorStr)),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    VerticalAlignment = VerticalAlignment.Center,
                    HorizontalContentAlignment = HorizontalAlignment.Center,
                    VerticalContentAlignment = VerticalAlignment.Center,
                    TextAlignment = TextAlignment.Center,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0, 0, 0, 1),
                    BorderBrush = Brushes.Transparent,
                    Padding = new Thickness(2, 6, 2, 6),
                    FontSize = 12
                };

                // Focus highlights border
                headerTbx.GotFocus += (s, e) => headerTbx.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(fgColorStr));
                headerTbx.LostFocus += (s, e) => headerTbx.BorderBrush = Brushes.Transparent;
                headerTbx.TextChanged += (s, e) => { col.Header = headerTbx.Text; OnDataChanged(); };

                col.HeaderTextBox = headerTbx;
                border.Child = headerTbx;
                Grid.SetRow(border, 1);
                Grid.SetColumn(border, colGridPos);
                TableGrid.Children.Add(border);
            }

            // --- Rows 2+: Charge Rows (Editable & Deletable) ---
            for (int rowIdx = 0; rowIdx < rowDefs.Count; rowIdx++)
            {
                var row = rowDefs[rowIdx];
                int gridRow = rowIdx + 2;
                row.ValueTextBoxes = new List<TextBox>();

                // Column 0: Checkbox + Editable Row Description + Delete row button
                var descBorder = new Border
                {
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F8FAFC")),
                    BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E2E8F0")),
                    BorderThickness = new Thickness(1, 0, 1, 1),
                    Padding = new Thickness(8, 4, 8, 4)
                };

                var rowHeaderPanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                
                // 1. Show/hide row checkbox
                var chk = new CheckBox
                {
                    IsChecked = row.IsEnabled,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 8, 0)
                };
                chk.Checked += (s, e) => { row.IsEnabled = true; OnDataChanged(); };
                chk.Unchecked += (s, e) => { row.IsEnabled = false; OnDataChanged(); };
                row.RowCheckBox = chk;
                rowHeaderPanel.Children.Add(chk);

                // 2. Editable Row Description TextBox
                var rowTbx = new TextBox
                {
                    Text = row.Header,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#334155")),
                    VerticalAlignment = VerticalAlignment.Center,
                    VerticalContentAlignment = VerticalAlignment.Center,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0, 0, 0, 1),
                    BorderBrush = Brushes.Transparent,
                    Padding = new Thickness(2, 6, 2, 6),
                    Width = 210,
                    FontSize = 12
                };
                rowTbx.GotFocus += (s, e) => rowTbx.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3B82F6"));
                rowTbx.LostFocus += (s, e) => rowTbx.BorderBrush = Brushes.Transparent;
                rowTbx.TextChanged += (s, e) => { row.Header = rowTbx.Text; OnDataChanged(); };
                row.HeaderTextBox = rowTbx;
                rowHeaderPanel.Children.Add(rowTbx);

                // 3. Delete row button
                var deleteRowBtn = new Button
                {
                    Content = "❌",
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    ToolTip = "Delete this row",
                    FontSize = 10,
                    Margin = new Thickness(4, 0, 0, 0)
                };
                int localRowIdx = rowIdx;
                deleteRowBtn.Click += (s, e) =>
                {
                    var result = MessageBox.Show($"Are you sure you want to delete row '{row.Header}'?", "Confirm Delete Row", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                    if (result == MessageBoxResult.Yes)
                    {
                        DeleteRow(localRowIdx);
                    }
                };
                rowHeaderPanel.Children.Add(deleteRowBtn);

                descBorder.Child = rowHeaderPanel;
                Grid.SetRow(descBorder, gridRow);
                Grid.SetColumn(descBorder, 0);
                TableGrid.Children.Add(descBorder);

                // Columns 1-M: Value TextBoxes
                for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
                {
                    var col = columnDefs[colIdx];
                    
                    // Make sure row's CurrentValues list matches the column count
                    if (colIdx >= row.CurrentValues.Count)
                    {
                        row.CurrentValues.Add("Rs.0/-");
                    }

                    string cellVal = row.CurrentValues[colIdx];
                    string fgColorStr = col.IsChennai ? "#16A34A" : "#2563EB"; // Green for Chennai, Blue for Tuti
                    string cellBgColorStr = col.IsChennai ? "#FCFDFC" : "#FCFDFF";

                    var cellBorder = new Border
                    {
                        Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(cellBgColorStr)),
                        BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E2E8F0")),
                        BorderThickness = new Thickness(0, 0, 1, 1),
                        Padding = new Thickness(3)
                    };

                    var tbx = new TextBox
                    {
                        Text = cellVal,
                        Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(fgColorStr)),
                        FontWeight = FontWeights.Medium,
                        HorizontalContentAlignment = HorizontalAlignment.Center,
                        VerticalContentAlignment = VerticalAlignment.Center,
                        BorderThickness = new Thickness(1),
                        BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E2E8F0")),
                        Padding = new Thickness(4, 6, 4, 6),
                        Background = Brushes.Transparent,
                        FontSize = 12
                    };

                    tbx.GotFocus += (s, e) => tbx.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3B82F6"));
                    tbx.LostFocus += (s, e) => tbx.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E2E8F0"));
                    tbx.TextChanged += (s, e) => OnDataChanged();

                    row.ValueTextBoxes.Add(tbx);
                    cellBorder.Child = tbx;

                    Grid.SetRow(cellBorder, gridRow);
                    Grid.SetColumn(cellBorder, colIdx + 1);
                    TableGrid.Children.Add(cellBorder);
                }
            }
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

        private void DeleteColumn(int index)
        {
            if (index >= 0 && index < columnDefs.Count)
            {
                SaveCurrentValuesFromUI();
                columnDefs.RemoveAt(index);
                
                // Also clean up data lists in each row def
                foreach (var row in rowDefs)
                {
                    if (index < row.CurrentValues.Count)
                    {
                        row.CurrentValues.RemoveAt(index);
                    }
                    if (index < row.DefaultValues.Count)
                    {
                        row.DefaultValues.RemoveAt(index);
                    }
                }

                BuildGridWorkspace();
                UpdatePreview();
                StatusTxt.Text = "Column deleted.";
            }
        }

        private void AddRowBtn_Click(object sender, RoutedEventArgs e)
        {
            SaveCurrentValuesFromUI();
            
            var newRow = new RowDef
            {
                Header = "New Charge Item",
                IsEnabled = true
            };

            for (int i = 0; i < columnDefs.Count; i++)
            {
                newRow.DefaultValues.Add("Rs.0/-");
                newRow.CurrentValues.Add("Rs.0/-");
            }

            rowDefs.Add(newRow);
            BuildGridWorkspace();
            UpdatePreview();
            StatusTxt.Text = "New row added. Double-click and edit its name and prices.";
        }

        private void AddColumnBtn_Click(object sender, RoutedEventArgs e)
        {
            SaveCurrentValuesFromUI();

            var newCol = new ColumnDef
            {
                Header = "New Column",
                IsEnabled = true,
                IsChennai = true // Default to green
            };

            columnDefs.Add(newCol);

            foreach (var row in rowDefs)
            {
                row.DefaultValues.Add("Rs.0/-");
                row.CurrentValues.Add("Rs.0/-");
            }

            BuildGridWorkspace();
            UpdatePreview();
            StatusTxt.Text = "New column added. Edit the top cell to name the column.";
        }

        private void OnDataChanged()
        {
            if (isInitializing) return;
            UpdatePreview();
        }

        private void QuoteDetail_TextChanged(object sender, TextChangedEventArgs e)
        {
            OnDataChanged();
        }

        /// <summary>
        /// Updates the WebBrowser live HTML preview panel on the right.
        /// </summary>
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

        /// <summary>
        /// Generates email-compliant HTML with inline styling based on selected options.
        /// </summary>
        private string GenerateHtmlTable()
        {
            string headerNote = HeaderNoteTxt.Text;
            string clientName = ClientNameTxt.Text;
            string quoteRef = QuoteRefTxt.Text;
            string dateStr = QuoteDateTxt.Text;
            string validityStr = ValidityTxt.Text;
            string subject = SubjectTxt.Text;

            var sb = new StringBuilder();

            // Add container wrapper
            sb.Append("<div style=\"font-family: 'Calibri', 'Arial', sans-serif; font-size: 14px; color: #334155; line-height: 1.5; max-width: 900px;\">");

            // Client Info Card
            sb.Append("<table style=\"width: 100%; border-collapse: collapse; margin-bottom: 20px; font-family: 'Calibri', 'Arial', sans-serif; font-size: 14px; border: none;\">");
            sb.Append($"<tr><td style=\"padding: 4px 0; font-weight: bold; color: #475569; width: 110px;\">Client Name:</td><td style=\"padding: 4px 0; color: #1e293b;\">{HtmlEncode(clientName)}</td><td style=\"padding: 4px 0; font-weight: bold; color: #475569; width: 100px; text-align: right;\">Date:</td><td style=\"padding: 4px 0; color: #1e293b; text-align: right;\">{HtmlEncode(dateStr)}</td></tr>");
            sb.Append($"<tr><td style=\"padding: 4px 0; font-weight: bold; color: #475569;\">Quote Ref:</td><td style=\"padding: 4px 0; color: #1e293b;\">{HtmlEncode(quoteRef)}</td><td style=\"padding: 4px 0; font-weight: bold; color: #475569; text-align: right;\">Validity:</td><td style=\"padding: 4px 0; color: #1e293b; text-align: right;\">{HtmlEncode(validityStr)}</td></tr>");
            sb.Append($"<tr><td style=\"padding: 4px 0; font-weight: bold; color: #475569;\">Subject:</td><td colspan=\"3\" style=\"padding: 4px 0; color: #1e293b; font-weight: bold;\">{HtmlEncode(subject)}</td></tr>");
            sb.Append("</table>");

            // Header note text preceding the quote table
            if (!string.IsNullOrWhiteSpace(headerNote))
            {
                sb.Append($"<p style=\"margin-top: 0; margin-bottom: 15px; font-family: 'Calibri', 'Arial', sans-serif; font-size: 14px; color: #1e293b;\">{HtmlEncode(headerNote)}</p>");
            }

            // Main Quote Table
            sb.Append("<table style=\"border-collapse: collapse; width: 100%; font-family: 'Calibri', 'Arial', sans-serif; font-size: 13px; border: 2px solid #0f172a;\">");

            // --- Headers Row ---
            sb.Append("<thead><tr style=\"background-color: #0f172a; color: #ffffff;\">");
            sb.Append("<th style=\"border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; background-color: #0f172a; font-weight: bold; font-size: 13px;\">Charges Description</th>");

            for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
            {
                var col = columnDefs[colIdx];
                if (col.IsEnabled)
                {
                    string colBgColor = col.IsChennai ? "#e2f0d9" : "#ddebf7";
                    string colFgColor = col.IsChennai ? "#2e7d32" : "#1565c0";
                    string headerStyle = $"border: 1px solid #cbd5e1; padding: 10px 12px; text-align: center; background-color: {colBgColor}; color: {colFgColor}; font-weight: bold; font-size: 13px;";
                    sb.Append($"<th style=\"{headerStyle}\">{HtmlEncode(col.Header)}</th>");
                }
            }
            sb.Append("</tr></thead>");

            // --- Data Rows ---
            sb.Append("<tbody>");
            for (int rowIdx = 0; rowIdx < rowDefs.Count; rowIdx++)
            {
                var row = rowDefs[rowIdx];
                if (row.IsEnabled)
                {
                    sb.Append("<tr>");
                    // Row Label
                    sb.Append($"<td style=\"border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; font-weight: bold; background-color: #f8fafc; color: #334155; font-size: 13px;\">{HtmlEncode(row.Header)}</td>");

                    // Cell values
                    for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
                    {
                        var col = columnDefs[colIdx];
                        if (col.IsEnabled)
                        {
                            string cellVal = (colIdx < row.ValueTextBoxes.Count && row.ValueTextBoxes[colIdx] != null) 
                                ? row.ValueTextBoxes[colIdx].Text 
                                : (colIdx < row.CurrentValues.Count ? row.CurrentValues[colIdx] : "Rs.0/-");

                            string cellFgColor = col.IsChennai ? "#2e7d32" : "#1565c0";
                            string cellStyle = $"border: 1px solid #cbd5e1; padding: 8px 12px; text-align: center; color: {cellFgColor}; font-weight: bold; background-color: #ffffff; font-size: 13px;";
                            sb.Append($"<td style=\"{cellStyle}\">{HtmlEncode(cellVal)}</td>");
                        }
                    }
                    sb.Append("</tr>");
                }
            }
            sb.Append("</tbody>");
            sb.Append("</table>");

            // Footer notes
            sb.Append("<p style=\"margin-top: 15px; margin-bottom: 0; font-size: 12px; color: #64748b; font-family: 'Calibri', 'Arial', sans-serif; font-style: italic;\">** Rates are subject to change and specific terms and conditions. **</p>");
            sb.Append("</div>");

            return sb.ToString();
        }

        /// <summary>
        /// Generates a clean plain text table layout.
        /// </summary>
        private string GeneratePlainText()
        {
            var sb = new StringBuilder();

            sb.AppendLine($"Client Name: {ClientNameTxt.Text}");
            sb.AppendLine($"Quote Ref:   {QuoteRefTxt.Text}");
            sb.AppendLine($"Date:        {QuoteDateTxt.Text}");
            sb.AppendLine($"Validity:    {ValidityTxt.Text}");
            sb.AppendLine($"Subject:     {SubjectTxt.Text}");
            sb.AppendLine();
            
            if (!string.IsNullOrWhiteSpace(HeaderNoteTxt.Text))
            {
                sb.AppendLine(HeaderNoteTxt.Text);
                sb.AppendLine();
            }

            int descWidth = 45;
            int colWidth = 18;

            // Headers
            sb.Append("Charges Description".PadRight(descWidth));
            for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
            {
                var col = columnDefs[colIdx];
                if (col.IsEnabled)
                {
                    sb.Append(" | " + col.Header.PadLeft(colWidth));
                }
            }
            sb.AppendLine();

            // Divider Line
            sb.Append(new string('-', descWidth));
            for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
            {
                var col = columnDefs[colIdx];
                if (col.IsEnabled)
                {
                    sb.Append("-|-" + new string('-', colWidth));
                }
            }
            sb.AppendLine();

            // Rows
            for (int rowIdx = 0; rowIdx < rowDefs.Count; rowIdx++)
            {
                var row = rowDefs[rowIdx];
                if (row.IsEnabled)
                {
                    sb.Append(row.Header.PadRight(descWidth));
                    for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
                    {
                        var col = columnDefs[colIdx];
                        if (col.IsEnabled)
                        {
                            string cellVal = (colIdx < row.ValueTextBoxes.Count && row.ValueTextBoxes[colIdx] != null) 
                                ? row.ValueTextBoxes[colIdx].Text 
                                : (colIdx < row.CurrentValues.Count ? row.CurrentValues[colIdx] : "Rs.0/-");
                            sb.Append(" | " + cellVal.PadLeft(colWidth));
                        }
                    }
                    sb.AppendLine();
                }
            }

            sb.AppendLine();
            sb.AppendLine("** Rates are subject to change and specific terms and conditions. **");

            return sb.ToString();
        }

        /// <summary>
        /// Copies the HTML table to the Windows Clipboard using the correct HTML format wrapper
        /// so Outlook, Word, Gmail and other applications paste it as a styled rich text table.
        /// </summary>
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

                StatusTxt.Text = "HTML Table copied to Clipboard! You can now paste (Ctrl+V) directly into Outlook, Gmail, or Word.";
                MessageBox.Show("HTML Table copied to Clipboard!\n\nYou can now paste it directly into an email draft (Outlook, Gmail, etc.) using Ctrl+V. The styling, borders, and colors will be preserved.", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Failed to copy: " + ex.Message;
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
                StatusTxt.Text = "Plain Text Table copied to Clipboard!";
                MessageBox.Show("Plain Text Table copied to Clipboard!", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
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
                    FileName = $"Quotation_{ClientNameTxt.Text.Replace(" ", "_")}.html",
                    Title = "Export Quotation to HTML File"
                };

                if (sfd.ShowDialog() == true)
                {
                    string html = GenerateHtmlTable();
                    string fullHtml = $@"<!DOCTYPE html>
<html>
<head>
    <meta charset=""utf-8"">
    <title>Quotation - {ClientNameTxt.Text}</title>
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
                    StatusTxt.Text = $"Exported to {Path.GetFileName(sfd.FileName)} successfully.";
                    MessageBox.Show("Quotation HTML file exported successfully!", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                StatusTxt.Text = "Failed to save file: " + ex.Message;
                MessageBox.Show("Failed to export HTML file: " + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void ExportExcelBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                SaveCurrentValuesFromUI();
                
                string quoteRef = QuoteRefTxt.Text;
                string clientName = ClientNameTxt.Text;
                
                char[] invalidChars = Path.GetInvalidFileNameChars();
                
                string sanitizedQuoteRef = quoteRef;
                foreach (char c in invalidChars)
                {
                    sanitizedQuoteRef = sanitizedQuoteRef.Replace(c, '_');
                }
                
                string sanitizedClientName = clientName;
                foreach (char c in invalidChars)
                {
                    sanitizedClientName = sanitizedClientName.Replace(c, '_');
                }
                
                string defaultFileName = $"{sanitizedQuoteRef}_{sanitizedClientName}.xlsx";
                defaultFileName = defaultFileName.Replace("__", "_").Trim('_');
                if (!defaultFileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
                {
                    defaultFileName += ".xlsx";
                }

                var sfd = new SaveFileDialog
                {
                    Filter = "Excel Workbooks (*.xlsx)|*.xlsx|All Files (*.*)|*.*",
                    FileName = defaultFileName,
                    Title = "Export Quotation to Excel"
                };

                if (sfd.ShowDialog() == true)
                {
                    GenerateExcelWorkbook(sfd.FileName);
                    StatusTxt.Text = $"Exported to {Path.GetFileName(sfd.FileName)} successfully.";
                    MessageBox.Show("Quotation Excel file exported successfully!", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
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
                var ws = workbook.Worksheets.Add("Quotation");

                ws.Style.Font.FontName = "Calibri";
                ws.Style.Font.FontSize = 11;

                // 1. Title Block (Header)
                ws.Cell("A1").Value = "SHIPPING QUOTATION";
                ws.Cell("A1").Style.Font.Bold = true;
                ws.Cell("A1").Style.Font.FontSize = 16;
                ws.Cell("A1").Style.Font.FontColor = XLColor.FromHtml("#0F172A");
                ws.Range("A1:D1").Merge();

                // 2. Metadata Block
                ws.Cell("A3").Value = "Client Name:";
                ws.Cell("A3").Style.Font.Bold = true;
                ws.Cell("A3").Style.Font.FontColor = XLColor.FromHtml("#475569");
                ws.Cell("B3").Value = ClientNameTxt.Text;

                ws.Cell("C3").Value = "Date:";
                ws.Cell("C3").Style.Font.Bold = true;
                ws.Cell("C3").Style.Font.FontColor = XLColor.FromHtml("#475569");
                ws.Cell("C3").Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                ws.Cell("D3").Value = QuoteDateTxt.Text;
                ws.Cell("D3").Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;

                ws.Cell("A4").Value = "Quote Ref:";
                ws.Cell("A4").Style.Font.Bold = true;
                ws.Cell("A4").Style.Font.FontColor = XLColor.FromHtml("#475569");
                ws.Cell("B4").Value = QuoteRefTxt.Text;

                ws.Cell("C4").Value = "Validity:";
                ws.Cell("C4").Style.Font.Bold = true;
                ws.Cell("C4").Style.Font.FontColor = XLColor.FromHtml("#475569");
                ws.Cell("C4").Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                ws.Cell("D4").Value = ValidityTxt.Text;
                ws.Cell("D4").Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;

                ws.Cell("A5").Value = "Subject:";
                ws.Cell("A5").Style.Font.Bold = true;
                ws.Cell("A5").Style.Font.FontColor = XLColor.FromHtml("#475569");
                ws.Cell("B5").Value = SubjectTxt.Text;
                ws.Range("B5:D5").Merge();

                // 3. Preceding note
                int currentExcelRow = 7;
                if (!string.IsNullOrWhiteSpace(HeaderNoteTxt.Text))
                {
                    ws.Cell(currentExcelRow, 1).Value = HeaderNoteTxt.Text;
                    ws.Cell(currentExcelRow, 1).Style.Font.Italic = true;
                    
                    int totalCols = 1;
                    foreach (var col in columnDefs)
                    {
                        if (col.IsEnabled) totalCols++;
                    }
                    ws.Range(currentExcelRow, 1, currentExcelRow, totalCols).Merge();
                    currentExcelRow += 2;
                }

                // 4. Quotation Table
                int tableStartRow = currentExcelRow;

                // --- Table Headers ---
                ws.Cell(currentExcelRow, 1).Value = "Charges Description";
                ws.Cell(currentExcelRow, 1).Style.Font.Bold = true;
                ws.Cell(currentExcelRow, 1).Style.Font.FontColor = XLColor.White;
                ws.Cell(currentExcelRow, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#0F172A");
                ws.Cell(currentExcelRow, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
                ws.Cell(currentExcelRow, 1).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                ws.Cell(currentExcelRow, 1).Style.Border.OutsideBorderColor = XLColor.FromHtml("#CBD5E1");

                int currentExcelCol = 2;
                for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
                {
                    var col = columnDefs[colIdx];
                    if (col.IsEnabled)
                    {
                        var cell = ws.Cell(currentExcelRow, currentExcelCol);
                        cell.Value = col.Header;
                        cell.Style.Font.Bold = true;
                        
                        string colBgColor = col.IsChennai ? "#E2F0D9" : "#DDEBF7";
                        string colFgColor = col.IsChennai ? "#2E7D32" : "#1565C0";
                        cell.Style.Fill.BackgroundColor = XLColor.FromHtml(colBgColor);
                        cell.Style.Font.FontColor = XLColor.FromHtml(colFgColor);
                        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                        cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                        cell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#CBD5E1");
                        
                        currentExcelCol++;
                    }
                }

                currentExcelRow++;

                // --- Table Data Rows ---
                for (int rowIdx = 0; rowIdx < rowDefs.Count; rowIdx++)
                {
                    var row = rowDefs[rowIdx];
                    if (row.IsEnabled)
                    {
                        var descCell = ws.Cell(currentExcelRow, 1);
                        descCell.Value = row.Header;
                        descCell.Style.Font.Bold = true;
                        descCell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F8FAFC");
                        descCell.Style.Font.FontColor = XLColor.FromHtml("#334155");
                        descCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
                        descCell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                        descCell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#E2E8F0");

                        currentExcelCol = 2;
                        for (int colIdx = 0; colIdx < columnDefs.Count; colIdx++)
                        {
                            var col = columnDefs[colIdx];
                            if (col.IsEnabled)
                            {
                                string cellVal = (colIdx < row.ValueTextBoxes.Count && row.ValueTextBoxes[colIdx] != null) 
                                    ? row.ValueTextBoxes[colIdx].Text 
                                    : (colIdx < row.CurrentValues.Count ? row.CurrentValues[colIdx] : "Rs.0/-");

                                var valCell = ws.Cell(currentExcelRow, currentExcelCol);
                                valCell.Value = cellVal;
                                
                                string cellFgColor = col.IsChennai ? "#2E7D32" : "#1565C0";
                                valCell.Style.Font.FontColor = XLColor.FromHtml(cellFgColor);
                                valCell.Style.Font.Bold = true;
                                valCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                                valCell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                                valCell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#E2E8F0");

                                currentExcelCol++;
                            }
                        }
                        currentExcelRow++;
                    }
                }

                int totalTableCols = currentExcelCol - 1;
                var tableRange = ws.Range(tableStartRow, 1, currentExcelRow - 1, totalTableCols);
                tableRange.Style.Border.OutsideBorder = XLBorderStyleValues.Medium;
                tableRange.Style.Border.OutsideBorderColor = XLColor.FromHtml("#0F172A");

                // 5. Footer Notes
                currentExcelRow++;
                var footerCell = ws.Cell(currentExcelRow, 1);
                footerCell.Value = "** Rates are subject to change and specific terms and conditions. **";
                footerCell.Style.Font.Italic = true;
                footerCell.Style.Font.FontSize = 9;
                footerCell.Style.Font.FontColor = XLColor.FromHtml("#64748B");
                ws.Range(currentExcelRow, 1, currentExcelRow, totalTableCols).Merge();

                // 6. Autofit columns
                ws.Columns().AdjustToContents();
                
                for (int col = 1; col <= totalTableCols; col++)
                {
                    ws.Column(col).Width += 3;
                }

                workbook.SaveAs(filePath);
            }
        }

        private void ResetBtn_Click(object sender, RoutedEventArgs e)
        {
            var result = MessageBox.Show("Are you sure you want to reset all details and cells to their original image defaults?", "Confirm Reset", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (result == MessageBoxResult.Yes)
            {
                InitializeData();
                StatusTxt.Text = "Reset to image defaults completed.";
            }
        }

        private void SelectAllRows_Click(object sender, RoutedEventArgs e)
        {
            isInitializing = true;
            foreach (var row in rowDefs)
            {
                row.IsEnabled = true;
                if (row.RowCheckBox != null)
                {
                    row.RowCheckBox.IsChecked = true;
                }
            }
            isInitializing = false;
            UpdatePreview();
            StatusTxt.Text = "All rows selected.";
        }

        private void DeselectAllRows_Click(object sender, RoutedEventArgs e)
        {
            isInitializing = true;
            foreach (var row in rowDefs)
            {
                row.IsEnabled = false;
                if (row.RowCheckBox != null)
                {
                    row.RowCheckBox.IsChecked = false;
                }
            }
            isInitializing = false;
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
    }
}
