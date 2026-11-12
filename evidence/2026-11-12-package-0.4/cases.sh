#!/usr/bin/env bash
# Demonstration for package 0.4, template half: the same cases through the template's licence
# check as it was on the integration branch before this package ("old") and as it is now ("new").
# Each case is a copy of templates/next with one thing changed. Nothing in the repository is changed.
# Arguments: a scratch folder; templates/next with its packages installed; the earlier script;
# the lock file from before sharp was removed; and, optionally, templates/next as it was at 892fa52.
set -uo pipefail
S="$1"; T="$2"; OLD="$3"; OLDLOCK="$4"
copy() { # copy the template; node_modules by hard links (only new files are ever added to it)
  local d="$S/demo04/$1"; mkdir -p "$d"
  (cd "$T" && tar cf - --exclude=node_modules --exclude=.next .) | (cd "$d" && tar xf -)
  cp -al "$T/node_modules" "$d/node_modules"
  cp "$OLD" "$d/scripts/old-check-licences.sh"
  echo "$d"
}
addpkg() { # dir name licence dev|prod [private]
  local d="$1" n="$2" lic="$3" kind="$4" priv="${5:-}"
  mkdir -p "$d/node_modules/$n"
  node -e '
    const fs=require("fs"),[d,n,lic,kind,priv]=process.argv.slice(1);
    const pj={name:n,version:"1.0.0",license:lic}; if(priv) pj.private=true;
    fs.writeFileSync(d+"/node_modules/"+n+"/package.json",JSON.stringify(pj));
    const root=JSON.parse(fs.readFileSync(d+"/package.json","utf8"));
    (kind==="dev"?root.devDependencies:root.dependencies)[n]="1.0.0";
    fs.writeFileSync(d+"/package.json",JSON.stringify(root,null,2)+"\n");
    const lock=JSON.parse(fs.readFileSync(d+"/package-lock.json","utf8"));
    lock.packages["node_modules/"+n]={version:"1.0.0",resolved:"https://registry.npmjs.org/"+n+"/-/"+n+"-1.0.0.tgz",license:lic,...(kind==="dev"?{dev:true}:{})};
    fs.writeFileSync(d+"/package-lock.json",JSON.stringify(lock,null,2)+"\n");
  ' "$d" "$n" "$lic" "$kind" "$priv"
}
run() { # dir label
  local d="$1"
  local o n
  o=$(cd "$d" && bash scripts/old-check-licences.sh 2>&1); local oc=$?
  n=$(cd "$d" && bash scripts/check-licences.sh 2>&1); local nc=$?
  echo "   old check: exit code $oc ($([ $oc -eq 0 ] && echo PASSES || echo fails))"
  [ $oc -ne 0 ] && echo "$o" | grep -E "not permitted|PROBLEMS|is listed|is recorded|Found license" | head -3 | sed 's/^/      /'
  echo "   new rule:  exit code $nc ($([ $nc -eq 0 ] && echo PASSES || echo fails))"
  [ $nc -ne 0 ] && echo "$n" | grep -E "^PROBLEM|^  .* \| .* \| " | grep -v "approved 20\|| installed" | head -${3:-4} | sed 's/^/      /'
  echo
}
echo "A. The template as it is"; d=$(copy A); run "$d"
echo "B. A shipped test package under GPL-3.0-only is added"; d=$(copy B); addpkg "$d" fake-gpl "GPL-3.0-only" prod; run "$d"
echo "C. A development-only test package under LGPL-3.0-or-later is added"; d=$(copy C); addpkg "$d" fake-lgpl-later "LGPL-3.0-or-later" dev; run "$d"
echo "D. A shipped test package declaring \"MIT AND LGPL-3.0\" is added"; d=$(copy D); addpkg "$d" fake-both "MIT AND LGPL-3.0" prod; run "$d"
echo "E. A shipped test package under GPL-3.0-only, marked private, is added"; d=$(copy E); addpkg "$d" fake-private "GPL-3.0-only" prod private; run "$d"
echo "F. The lock file lists a package under LGPL-3.0-or-later that only another machine would install"; d=$(copy F)
node -e 'const fs=require("fs"),f=process.argv[1]+"/package-lock.json",l=JSON.parse(fs.readFileSync(f,"utf8"));l.packages["node_modules/@fake/other-machine"]={version:"1.0.0",resolved:"https://registry.npmjs.org/@fake/other-machine/-/other-machine-1.0.0.tgz",license:"LGPL-3.0-or-later",optional:true,os:["darwin"]};fs.writeFileSync(f,JSON.stringify(l,null,2)+"\n")' "$d"; run "$d"
echo "G. The approved package caniuse-lite at another version (1.0.30001824), same licence"; d=$(copy G)
rm -rf "$d/node_modules/caniuse-lite"; cp -a "$T/node_modules/caniuse-lite" "$d/node_modules/caniuse-lite"
node -e 'const fs=require("fs"),d=process.argv[1];let f=d+"/node_modules/caniuse-lite/package.json",p=JSON.parse(fs.readFileSync(f,"utf8"));p.version="1.0.30001824";fs.writeFileSync(f,JSON.stringify(p));f=d+"/package-lock.json";const l=JSON.parse(fs.readFileSync(f,"utf8"));l.packages["node_modules/caniuse-lite"].version="1.0.30001824";fs.writeFileSync(f,JSON.stringify(l,null,2)+"\n")' "$d"; run "$d"
echo "I. A folder nested inside the installed package next calls itself by the stand-in's name and version (sharp@0.0.0-removed) and declares LGPL-3.0-or-later. Nothing else is changed; the lock file does not list it."; d=$(copy I)
mkdir -p "$d/node_modules/next/node_modules/sharp"
echo '{"name":"sharp","version":"0.0.0-removed","license":"LGPL-3.0-or-later"}' > "$d/node_modules/next/node_modules/sharp/package.json"
run "$d" 6
if [ -n "${5:-}" ]; then
  # The whole template as it was at commit 892fa52 (the fifth argument: a folder holding that
  # commit's templates/next), with the same installed packages and the same forged folder.
  d2="$S/demo04/I-at-892fa52"; mkdir -p "$d2"
  (cd "$5" && tar cf - .) | (cd "$d2" && tar xf -)
  cp -al "$T/node_modules" "$d2/node_modules"
  mkdir -p "$d2/node_modules/next/node_modules/sharp"
  echo '{"name":"sharp","version":"0.0.0-removed","license":"LGPL-3.0-or-later"}' > "$d2/node_modules/next/node_modules/sharp/package.json"
  n=$(cd "$d2" && bash scripts/check-licences.sh 2>&1); oc=$?
  echo "   the template's check as it was at commit 892fa52, before the review: exit code $oc ($([ $oc -eq 0 ] && echo PASSES || echo fails))"
  echo "$n" | tail -1 | sed 's/^/      /'
  echo
fi
echo "H. The lock file as it was before the image library sharp was removed (the installed packages unchanged)."
echo "   Only the new rule is run here, without the separate lock-file check that keeps sharp out:"; d=$(copy H); cp "$OLDLOCK" "$d/package-lock.json"
n=$(cd "$d" && npx tsx scripts/licence/check.ts 2>&1); echo "   new rule:  exit code $? "; echo "$n" | grep -E "^PROBLEM|^  .* \| .* \| " | grep -v "approved 20\|| installed" | sed 's/^/      /'
