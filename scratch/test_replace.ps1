$ErrorActionPreference = "Stop"
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    if ($f.Name -eq "contact.html") { continue }
    $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    
    # We want to transform any block containing FAQ, Mentions légales, Politique de confidentialité
    # Let's do string replacement or simple line-based regex
    # First let's remove any <a href="...faq.html"...>FAQ</a> that appears before Mentions légales
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($content, '\s*<a\s+href="[^"]*faq\.html"[^>]*>FAQ</a>', '')
    
    # Now before <a href="...mentions-legales.html"...>Mentions légales</a>, insert <a href="/faq.html">FAQ</a> · 
    # But only if it doesn't already have FAQ before it!
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($newContent, '<a\s+href="[^"]*mentions-legales\.html"[^>]*>Mentions légales</a>', '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a>')
    
    # And make sure politique-confidentialite.html link has leading slash if desired, or let's keep it clean:
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($newContent, '<a\s+href="[^"]*politique-confidentialite\.html"[^>]*>Politique de confidentialité</a>', '<a href="/politique-confidentialite.html">Politique de confidentialité</a>')
    
    if ($content -ne $newContent) {
        [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "Updated footer in $($f.Name)"
    }
}
Write-Host "Done footers update."
