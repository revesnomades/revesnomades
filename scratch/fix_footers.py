import glob
import re

for filepath in glob.glob("c:\\Users\\mlautery\\.antigravity\\revesnomades\\*.html"):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Fix corrupted utf-8 characters if any were introduced by powershell
    content = content.replace("lÃ©gales", "légales").replace("confidentialitÃ©", "confidentialité").replace("Â·", "·")
    
    # Replace any legal links block
    # We look for where mentions-legales.html is located
    # Let's clean up any existing standalone FAQ link right before Mentions légales
    content = re.sub(r'\s*<a[^>]*faq\.html[^>]*>[^<]*</a>\s*(?:·|\u00B7)?\s*', ' ', content)
    
    # Now replace mentions link with FAQ · Mentions légales
    content = re.sub(
        r'<a[^>]*mentions-legales\.html[^>]*>[^<]*</a>',
        '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a>',
        content
    )
    
    # Standardize politique link
    content = re.sub(
        r'<a[^>]*politique-confidentialite\.html[^>]*>[^<]*</a>',
        '<a href="/politique-confidentialite.html">Politique de confidentialité</a>',
        content
    )
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print("Cleaned and updated:", filepath)

print("All footers successfully standardized with Python UTF-8!")
