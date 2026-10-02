{
  description = "historical path of exile arbitrage scanner";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { self, nixpkgs }: let
    systems = [ "x86_64-linux" "aarch64-linux" ];
    for_each_system = nixpkgs.lib.genAttrs systems;
  in {
    devShells = for_each_system (system: let pkgs = nixpkgs.legacyPackages.${system}; in {
      default = pkgs.mkShell {
        packages = with pkgs; [ cargo rustc rustfmt clippy python3 nodejs_24 gh git ];
      };
    });
  };
}
