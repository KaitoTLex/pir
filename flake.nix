{
  description = "Bun and Node.js with npm fallback for older CPUs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };

        # Simple npm fallback for all Bun commands
        bun = pkgs.callPackage ./bun.nix { };

      in
      {
        packages = {
          nodejs = pkgs.nodejs_20;
          bun = bun;
          default = pkgs.buildEnv {
            name = "nodejs-bun-env";
            paths = [ bun ];
          };
        };

        devShells.default = pkgs.mkShell {
          name = "nodejs-bun-shell";
          buildInputs = [ bun ];
        };
      }
    );
}
