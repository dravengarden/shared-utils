{
  description = "shared-utils — business-free shared code for the columbus ecosystem";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      packages.${system} = {
        # The @shared-utils/ui SDK as a flat TS source tree, exposed for each
        # consuming app's flake to take as an input and stage into its web build
        # (`cp ${shared-utils.packages.ui}/. web/src/_shell/`). One source of
        # truth, referenced — not vendored/committed into N repos. Glob every
        # *.ts/*.tsx so a newly added primitive can't silently drop out. Emit an
        # index.ts barrel (re-exporting mod.ts) so a consumer can
        # `import … from "./_shell"` (a directory import).
        ui = pkgs.runCommand "shared-utils-ui-src" { } ''
          mkdir -p $out
          cp ${./packages/ui}/*.ts ${./packages/ui}/*.tsx $out/
          printf 'export * from "./mod.ts";\n' > $out/index.ts
        '';
        default = self.packages.${system}.ui;
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.deno ];
      };
    };
}
