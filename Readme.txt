rkdeveloptool gives you a simple way to read/write rockusb device.let's start.

compile and install
1. install libusb and libudev
	sudo apt-get install libudev-dev libusb-1.0-0-dev dh-autoreconf
2. go into root of rkdeveloptool
3. ./autogen.sh
4. ./configure
5. make

standalone libusb build
If you want the generated binary to avoid a runtime dependency on the
libusb shared library, configure with:
	./configure --enable-standalone
	make

This requires the libusb static archive from your package manager
(for example libusb-1.0.a). The binary will still depend on the normal
system runtime libraries for the target OS.

Windows build with MSYS2/MinGW
1. Install MSYS2 from https://www.msys2.org/
2. Open the "MSYS2 UCRT64" shell.
3. Install the build dependencies:
	pacman -Syu
	pacman -S --needed git wget autoconf automake make pkgconf \
		mingw-w64-ucrt-x86_64-gcc \
		mingw-w64-ucrt-x86_64-pkgconf \
		mingw-w64-ucrt-x86_64-libusb
4. Build a standalone-libusb executable:
	autoreconf -i
	./configure --enable-standalone
	make -j$(nproc)
	strip rkdeveloptool.exe

The standalone option links libusb statically and, on MinGW, also links
the GCC/C++ runtimes statically. The executable should not need
libusb-1.0.dll, libstdc++-6.dll or libgcc_s_seh-1.dll next to it.
It will still use normal Windows system DLLs. Check dependencies with:
	objdump -p rkdeveloptool.exe | grep "DLL Name"
If msys-2.0.dll is listed, the build was done from the wrong MSYS2 shell;
use the UCRT64 shell so the result is a native Windows executable.

For USB access on Windows, the Rockchip device must use a libusb-compatible
driver such as WinUSB. Zadig can install WinUSB for the connected Rockusb
device if Windows does not already expose it to libusb.

rkdeveloptool usage,input "rkdeveloptool -h" to see

example:
1.download kernel.img
sudo ./rkdeveloptool db RKXXLoader.bin    //download usbplug to device
sudo ./rkdeveloptool wl 0x8000 kernel.img //0x8000 is base of kernel partition,unit is sector.
sudo ./rkdeveloptool rd                   //reset device

compile error help
if you encounter the error like below:
./configure: line 4269: syntax error near unexpected token `LIBUSB1,libusb-1.0'
./configure: line 4269: `PKG_CHECK_MODULES(LIBUSB1,libusb-1.0)'

You should install pkg-config libusb-1.0:
	sudo apt-get install pkg-config libusb-1.0
