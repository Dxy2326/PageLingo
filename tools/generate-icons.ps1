# Generate PageLingo extension icons (16/32/48/128).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-icons.ps1
# Windows only, relies on .NET System.Drawing.

Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$IconsDir = Join-Path $ProjectRoot "icons"
if (-not (Test-Path $IconsDir)) {
    New-Item -ItemType Directory -Path $IconsDir | Out-Null
}

$ColorTop = [System.Drawing.Color]::FromArgb(255, 27, 88, 214)
$ColorBottom = [System.Drawing.Color]::FromArgb(255, 0, 170, 136)
$ColorWhite = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$ColorSoft = [System.Drawing.Color]::FromArgb(210, 255, 255, 255)
$ColorBadge = [System.Drawing.Color]::FromArgb(255, 20, 184, 166)

function New-RoundedRectPath {
    param([System.Drawing.Rectangle]$Rect, [int]$Radius)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Render-Icon {
    param([int]$Size, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $path = New-RoundedRectPath $rect ([Math]::Round($Size * 0.22))
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $ColorTop, $ColorBottom, 90)
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()

    $penWidth = [Math]::Max(1.2, $Size * 0.055)
    $pen = New-Object System.Drawing.Pen($ColorWhite, $penWidth)
    $softPen = New-Object System.Drawing.Pen($ColorSoft, ([Math]::Max(1, $Size * 0.035)))

    $globeSize = $Size * 0.58
    $globeX = (($Size - $globeSize) / 2) - ($Size * 0.04)
    $globeY = (($Size - $globeSize) / 2) - ($Size * 0.03)
    $globeRect = New-Object System.Drawing.RectangleF(
        [single]$globeX,
        [single]$globeY,
        [single]$globeSize,
        [single]$globeSize
    )
    $g.DrawEllipse($pen, $globeRect)

    if ($Size -ge 32) {
        $g.DrawArc($softPen, $globeRect, 200, 140)
        $g.DrawArc($softPen, $globeRect, 20, 140)
        $midY = $globeY + ($globeSize / 2)
        $g.DrawLine($softPen, [single]($globeX + $Size * 0.08), [single]$midY, [single]($globeX + $globeSize - $Size * 0.08), [single]$midY)

        $arcRect = New-Object System.Drawing.RectangleF(
            [single]($globeX + $globeSize * 0.28),
            [single]$globeY,
            [single]($globeSize * 0.44),
            [single]$globeSize
        )
        $g.DrawEllipse($softPen, $arcRect)
    }

    $pen.Dispose()
    $softPen.Dispose()

    if ($Size -ge 32) {
        $bubbleSize = $Size * 0.36
        $bubbleX = $Size - $bubbleSize - ($Size * 0.08)
        $bubbleY = $Size - $bubbleSize - ($Size * 0.08)

        $bubbleBrush = New-Object System.Drawing.SolidBrush($ColorBadge)
        $g.FillEllipse($bubbleBrush, [single]$bubbleX, [single]$bubbleY, [single]$bubbleSize, [single]$bubbleSize)
        $bubbleBrush.Dispose()

        $badgePen = New-Object System.Drawing.Pen($ColorWhite, ([Math]::Max(1.2, $Size * 0.04)))
        $g.DrawEllipse($badgePen, [single]$bubbleX, [single]$bubbleY, [single]$bubbleSize, [single]$bubbleSize)
        $badgePen.Dispose()

        if ($Size -ge 48) {
            $glyphPen = New-Object System.Drawing.Pen($ColorWhite, ([Math]::Max(1.4, $Size * 0.035)))
            $left = $bubbleX + $bubbleSize * 0.25
            $right = $bubbleX + $bubbleSize * 0.75
            $top = $bubbleY + $bubbleSize * 0.30
            $mid = $bubbleY + $bubbleSize * 0.54
            $bottom = $bubbleY + $bubbleSize * 0.74
            $g.DrawLine($glyphPen, [single]$left, [single]$bottom, [single]($bubbleX + $bubbleSize * 0.42), [single]$top)
            $g.DrawLine($glyphPen, [single]($bubbleX + $bubbleSize * 0.42), [single]$top, [single]($bubbleX + $bubbleSize * 0.58), [single]$bottom)
            $g.DrawLine($glyphPen, [single]($bubbleX + $bubbleSize * 0.32), [single]$mid, [single]($bubbleX + $bubbleSize * 0.52), [single]$mid)
            $g.DrawLine($glyphPen, [single]($bubbleX + $bubbleSize * 0.62), [single]$top, [single]$right, [single]$top)
            $g.DrawLine($glyphPen, [single]($bubbleX + $bubbleSize * 0.69), [single]$top, [single]($bubbleX + $bubbleSize * 0.69), [single]$bottom)
            $g.DrawLine($glyphPen, [single]($bubbleX + $bubbleSize * 0.61), [single]$bottom, [single]$right, [single]$bottom)
            $glyphPen.Dispose()
        }
    }

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  -> $OutPath ($Size x $Size)"
}

Write-Host "Generating icons into $IconsDir ..."
Render-Icon 16 (Join-Path $IconsDir "icon-16.png")
Render-Icon 32 (Join-Path $IconsDir "icon-32.png")
Render-Icon 48 (Join-Path $IconsDir "icon-48.png")
Render-Icon 128 (Join-Path $IconsDir "icon-128.png")
Write-Host "Done."
