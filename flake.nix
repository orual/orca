{
  description = "Orca local development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              pnpm_11
              python3
              pkg-config
              gnumake
              git
              jujutsu
              openssh
              electron_43
              xvfb
            ];

            ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_43.dist}";
            ELECTRON_EXEC_PATH = "${pkgs.electron_43}/bin/electron";
          };
        } // nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          android = let
            pkgs = import nixpkgs {
              system = "x86_64-linux";
              config = {
                allowUnfree = true;
                android_sdk.accept_license = true;
              };
            };
            android = pkgs.androidenv.composeAndroidPackages {
              platformVersions = [ "36" ];
              buildToolsVersions = [ "36.0.0" "35.0.0" ];
              includeNDK = true;
              ndkVersions = [ "27.1.12297006" ];
              includeCmake = true;
              cmakeVersions = [ "3.22.1" ];
              includeEmulator = true;
              includeSystemImages = true;
              systemImageTypes = [ "google_apis" ];
              abiVersions = [ "x86_64" ];
            };
            androidHome = "${android.androidsdk}/libexec/android-sdk";
          in pkgs.mkShell {
            packages = with pkgs; [ nodejs_24 pnpm_11 jdk17 git android.androidsdk ];
            JAVA_HOME = "${pkgs.jdk17}";
            ANDROID_HOME = androidHome;
            ANDROID_SDK_ROOT = androidHome;
            ANDROID_NDK_ROOT = "${androidHome}/ndk/27.1.12297006";
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidHome}/build-tools/36.0.0/aapt2";
            shellHook = ''
              export PATH="${androidHome}/cmake/3.22.1/bin:$PATH"
            '';
          };
        });
    };
}
