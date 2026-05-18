# 生成 X Helper 扩展图标（16/32/48/128）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-icons.ps1
# 仅 Windows，依赖 .NET System.Drawing。

Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$IconsDir = Join-Path $ProjectRoot "icons"
if (-not (Test-Path $IconsDir)) { New-Item -ItemType Directory -Path $IconsDir | Out-Null }

# X 主色蓝渐变 + 白色文字
$ColorTop    = [System.Drawing.Color]::FromArgb(255, 29, 155, 240)   # #1d9bf0
$ColorBottom = [System.Drawing.Color]::FromArgb(255, 10, 102, 194)   # #0a66c2
$ColorWhite  = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$ColorBubble = [System.Drawing.Color]::FromArgb(255, 0, 186, 124)    # 右下角气泡用绿色 #00ba7c (X 验证色)

function Render-Icon {
    param([int]$Size, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # 圆角矩形背景（蓝色渐变）
    $cornerRadius = [Math]::Round($Size * 0.22)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $cornerRadius * 2
    $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $ColorTop, $ColorBottom, 90)
    $g.FillPath($brush, $path)
    $brush.Dispose()

    # 中央 X 字符。用粗体 Arial Black 模拟 X 标志风格
    # 字体大小约为图标 65%
    $fontSize = $Size * 0.62
    $font = $null
    foreach ($family in @("Arial Black", "Impact", "Arial")) {
        try {
            $font = New-Object System.Drawing.Font($family, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            break
        } catch { continue }
    }
    if (-not $font) {
        $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    }

    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    # 字符垂直对齐微调（Arial Black 的 X 视觉中心略偏下）
    $rectX = [single]0
    $rectY = [single](-$Size * 0.04)
    $rectW = [single]$Size
    $rectH = [single]$Size
    $textRect = New-Object System.Drawing.RectangleF -ArgumentList $rectX, $rectY, $rectW, $rectH
    $textBrush = New-Object System.Drawing.SolidBrush($ColorWhite)
    $g.DrawString("X", $font, $textBrush, $textRect, $sf)
    $textBrush.Dispose()

    # 右下角小气泡：表示 "对话/翻译" 助手身份（仅 32+ 尺寸画，避免 16px 糊）
    if ($Size -ge 32) {
        $bubbleSize = $Size * 0.34
        $bubbleX = $Size - $bubbleSize - $Size * 0.08
        $bubbleY = $Size - $bubbleSize - $Size * 0.08

        $bubbleBrush = New-Object System.Drawing.SolidBrush($ColorBubble)
        $g.FillEllipse($bubbleBrush, $bubbleX, $bubbleY, $bubbleSize, $bubbleSize)
        $bubbleBrush.Dispose()

        # 气泡里 3 个白点（"...")，仅 48+ 尺寸画
        if ($Size -ge 48) {
            $dotR = $Size * 0.04
            $cx = $bubbleX + $bubbleSize / 2
            $cy = $bubbleY + $bubbleSize / 2
            $offsetX = $bubbleSize * 0.22
            $dotBrush = New-Object System.Drawing.SolidBrush($ColorWhite)
            foreach ($dx in @(-$offsetX, 0, $offsetX)) {
                $g.FillEllipse($dotBrush, $cx + $dx - $dotR, $cy - $dotR, $dotR * 2, $dotR * 2)
            }
            $dotBrush.Dispose()
        }
    }

    $font.Dispose()
    $sf.Dispose()
    $g.Dispose()

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  → $OutPath ($Size x $Size)"
}

Write-Host "Generating icons into $IconsDir ..."
Render-Icon 16  (Join-Path $IconsDir "icon-16.png")
Render-Icon 32  (Join-Path $IconsDir "icon-32.png")
Render-Icon 48  (Join-Path $IconsDir "icon-48.png")
Render-Icon 128 (Join-Path $IconsDir "icon-128.png")
Write-Host "Done."
