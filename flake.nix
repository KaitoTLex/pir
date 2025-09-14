{
  description = "Bun and Node.js development environment";

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

        # Select appropriate packages for the system
        nodejs = pkgs.nodejs_20;
        bun =
          if pkgs.stdenv.isLinux || pkgs.stdenv.isDarwin then
            pkgs.bun
          else
            pkgs.bun.overrideAttrs (old: {
              meta = old.meta // {
                broken = true;
              };
            });

      in
      {
        packages = {
          inherit nodejs bun;
          default = pkgs.buildEnv {
            name = "mentra";
            paths = [
              nodejs
              bun
            ];
          };
        };

        devShells.default = pkgs.mkShell {
          name = "mentra";
          packages = with pkgs; [
            nodejs
            bun
            ngrok
          ];

          shellHook = ''
            echo "Node.js $(node --version) and Bun $(bun --version) environment ready"
          '';
        };
      }
    );
}
