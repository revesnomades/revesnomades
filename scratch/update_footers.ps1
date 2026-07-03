$ErrorActionPreference = "Stop"
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    
    # Remove any existing FAQ link in the legal section
    # Let's replace the whole legal div inner content
    $pattern = '(?s)(<div class="legal".*?<div>)\s*<a[^>]*>FAQ</a>\s*(?:·\s*)?<a[^>]*mentions-legales\.html[^>]*>Mentions légales</a>\s*·\s*<a[^>]*politique-confidentialite\.html[^>]*>Politique de confidentialité</a>\s*(</div>)'
    $replacement = '$1<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a> · <a href="/politique-confidentialite.html">Politique de confidentialité</a>$2'
    
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $replacement)
    
    if ($content -ne $newContent) {
        [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "Updated footer in $($f.Name)"
    } else {
        # Let's try a fallback pattern if the legal div class is slightly different (like in compte.html where <div class="legal"> is without reveal class)
        $pattern2 = '(?s)(<div class="legal">.*?<div>)\s*<a[^>]*>FAQ</a>\s*(?:·\s*)?<a[^>]*mentions-legales\.html[^>]*>Mentions légales</a>\s*·\s*<a[^>]*politique-confidentialite\.html[^>]*>Politique de confidentialité</a>\s*(</div>)'
        $newContent2 = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern2, $replacement)
        if ($content -ne $newContent2) {
            [System.IO.File]::WriteAllText($f.FullName, $newContent2, [System.Text.Encoding]::UTF8)
            Write-Host "Updated footer (fallback) in $($f.Name)"
        }
    }
}
Write-Host "Done footers."
