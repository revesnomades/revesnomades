$ErrorActionPreference = "Stop"
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    $c = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    
    # First remove any standalone FAQ link with style or block above Mentions
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '\s*<a\s+href="/?faq\.html"[^>]*>FAQ</a>', '')
    
    # Now replace mentions-legales.html with FAQ · Mentions légales
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<a\s+href="/?mentions-legales\.html"[^>]*>Mentions légales</a>', '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a>')
    
    # Ensure politique link has leading slash
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<a\s+href="/?politique-confidentialite\.html"[^>]*>Politique de confidentialité</a>', '<a href="/politique-confidentialite.html">Politique de confidentialité</a>')
    
    [System.IO.File]::WriteAllText($f.FullName, $c, [System.Text.Encoding]::UTF8)
    Write-Host "Processed $($f.Name)"
}
Write-Host "All footers standardized!"
