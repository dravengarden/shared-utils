{
  description = "shared-utils — business-free shared code for the columbus ecosystem";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      lib = pkgs.lib;

      # Pinned Deno 2.8.1 — nixpkgs `nixos-unstable` still ships an older 2.7.x,
      # so the whole ecosystem pulls the official prebuilt binary. One pin here
      # instead of an identical copy in every consuming app's flake. Once nixpkgs
      # catches up, delete this and point callers at `pkgs.deno`.
      deno = pkgs.stdenvNoCC.mkDerivation rec {
        pname = "deno";
        version = "2.8.1";
        src = pkgs.fetchurl {
          url = "https://github.com/denoland/deno/releases/download/v${version}/deno-x86_64-unknown-linux-gnu.zip";
          hash = "sha256-LXu2GVImrIMuC/cQmhFfCvZe5prHl6S73lsnoGzCQtk=";
        };
        nativeBuildInputs = [ pkgs.unzip pkgs.autoPatchelfHook ];
        buildInputs = [ pkgs.stdenv.cc.cc.lib pkgs.zlib ];
        unpackPhase = "unzip $src";
        installPhase = "install -Dm755 deno $out/bin/deno";
        meta = {
          description = "A modern runtime for JavaScript and TypeScript";
          homepage = "https://deno.land/";
          mainProgram = "deno";
        };
      };

      uiSrc = self.packages.${system}.ui;

      # The ONE correct way to build a Deno + Vite SPA in Nix, shared by every
      # app in the ecosystem.
      #
      # Why this exists: the obvious approach wraps the whole `deno install +
      # vite build` in a single fixed-output derivation (FOD), because the
      # install step needs network. But an FOD is addressed ONLY by its declared
      # `outputHash`, while the built bundle's bytes vary with source — so Nix
      # reuses the cached output whenever the hash is unchanged and silently
      # embeds a STALE bundle when only the source moved. That footgun forced a
      # manual hash rebump on every web edit, and shipped stale UIs to prod when
      # someone (always) forgot.
      #
      # The fix separates the two concerns the single FOD conflated:
      #   <pname>-web-deps — a SMALL FOD that vendors ONLY the npm deps (the part
      #                      that needs network) into a relocatable DENO_DIR.
      #                      Keyed by the lockfiles → its hash changes only when
      #                      deno.lock / package.json change.
      #   <pname>-web      — a NORMAL, sandboxed, content-addressed derivation
      #                      that consumes that cache OFFLINE. Any source edit →
      #                      new inputs → automatic rebuild. No hash bump, ever.
      #
      # Centralising it here means the footgun is structurally impossible to
      # reintroduce, and the shared SDK staging (`web/src/_shell`) + the Deno pin
      # stop being copy-pasted into N flakes.
      #
      # Args:
      #   pname       — derivation name prefix (e.g. "cowboy").
      #   src         — the app source (use `lib.cleanSource ./.`).
      #   webRoot     — subdir holding deno.json / package.json / the build's
      #                 `dist/` output. "web" for most apps, "." when the web
      #                 project IS the repo root (hermes, theia).
      #   depsHash    — FOD hash of the vendored deno cache. Refresh ONLY when the
      #                 app's lockfiles change: lib.fakeHash → build → copy "got".
      #   stageShell  — stage the @shared-utils/ui SDK into <webRoot>/src/_shell.
      #   installArgs — args to `deno install` (e.g. "--frozen --allow-scripts").
      #   nodejs      — node for any tool deno's npm interop can't shim.
      buildDenoViteApp =
        { pname
        , version ? "0.1.0"
        , src
        , webRoot ? "web"
        , depsHash
        , stageShell ? true
        , installArgs ? "--frozen"
        , nodejs ? pkgs.nodejs_24
        }:
        let
          # Deps-only FOD: a relocatable DENO_DIR npm cache built from the
          # lockfiles alone (so its identity tracks deps, not source).
          webDeps = pkgs.stdenvNoCC.mkDerivation {
            pname = "${pname}-web-deps";
            inherit version;
            src = pkgs.runCommandLocal "${pname}-web-deps-src" { } ''
              mkdir -p $out
              for f in deno.json deno.jsonc deno.lock package.json; do
                if [ -e "${src}/${webRoot}/$f" ]; then cp "${src}/${webRoot}/$f" "$out/$f"; fi
              done
            '';
            nativeBuildInputs = [ deno nodejs ];
            dontUnpack = true;
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              export DENO_DIR=$out
              # Deno's bundled CA roots don't cover the build sandbox; point TLS
              # at cacert so the npm-registry handshake succeeds.
              export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
              cp -RL $src/. .
              chmod -R u+w .
              deno install ${installArgs}
            '';
            dontInstall = true;
            dontFixup = true;
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = depsHash;
          };
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "${pname}-web";
          inherit version src;
          nativeBuildInputs = [ deno nodejs ];
          dontConfigure = true;
          buildPhase = ''
            export HOME=$TMPDIR
            # DENO_DIR must be writable (deno touches it); copy the vendored cache.
            export DENO_DIR=$TMPDIR/deno-cache
            cp -R ${webDeps} $DENO_DIR
            chmod -R u+w $DENO_DIR
            ${lib.optionalString stageShell ''
              # Stage the shared @shared-utils/ui SDK into the gitignored _shell.
              mkdir -p ${webRoot}/src/_shell
              cp ${uiSrc}/* ${webRoot}/src/_shell/
              chmod -R u+w ${webRoot}/src/_shell
            ''}
            cd ${webRoot}
            # Offline: deps are pre-vendored. The sandbox has no network, so a
            # missing dep fails loudly instead of silently drifting.
            deno install ${installArgs}
            deno task build
          '';
          installPhase = ''
            cp -R dist $out
          '';
          dontFixup = true;
        };
    in
    {
      packages.${system} = {
        # The @shared-utils/ui SDK as a flat TS source tree, exposed for each
        # consuming app's flake to take as an input and stage into its web build
        # (`cp ${shared-utils.packages.ui}/. web/src/_shell/`). One source of
        # truth, referenced — not vendored/committed into N repos. Glob every
        # *.ts/*.tsx so a newly added primitive can't silently drop out (index.ts
        # is the directory-import barrel; mod.ts is the Deno/JSR entry).
        ui = pkgs.runCommand "shared-utils-ui-src" { } ''
          mkdir -p $out
          cp ${./packages/ui}/*.ts ${./packages/ui}/*.tsx $out/
        '';
        # The pinned Deno, exposed so apps drop their own copy of this derivation.
        deno = deno;
        default = self.packages.${system}.ui;
      };

      # The shared Nix builders. `buildDenoViteApp` is the canonical, footgun-free
      # way to build any app's SPA; see its comment above.
      lib.${system} = {
        inherit buildDenoViteApp deno;
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [ deno ];
      };
    };
}
