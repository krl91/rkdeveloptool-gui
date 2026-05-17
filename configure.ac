dnl Copyright (C) 2017  Trevor Woerner <twoerner@gmail.com>

AC_INIT([Rockchip rkdeveloptool], 1.32, [Eddie Cai <eddie.cai.linux@gmail.com>], rkdeveloptool)
AC_PREREQ([2.68])
AC_CONFIG_SRCDIR(main.cpp)
AC_CONFIG_AUX_DIR(cfg)
AM_INIT_AUTOMAKE([foreign no-dist-gzip dist-bzip2 1.9])
AM_CONFIG_HEADER(cfg/config.h)

SUBDIRS=""

AC_PROG_CPP
AC_PROG_CXX
AC_PROG_CXXCPP
AC_PROG_MAKE_SET
AC_PROG_INSTALL
AC_PROG_LN_S
PKG_PROG_PKG_CONFIG

AC_ARG_ENABLE([standalone],
	AS_HELP_STRING([--enable-standalone],
		[link libusb statically when libusb-1.0.a is available]))

AC_CANONICAL_HOST
case "$host_os" in
	freebsd*)
		CPPFLAGS="$CFLAGS -I/usr/local/include"
		LDFLAGS="$LDFLAGS -L/usr/local/lib"
		;;
	openbsd*)
		CPPFLAGS="$CFLAGS -I/usr/local/include"
		LDFLAGS="$LDFLAGS -L/usr/local/lib"
		;;
	*)
		;;
esac


AS_IF([test "x$enable_standalone" = "xyes"], [
	PKG_CHECK_MODULES([LIBUSB1], [libusb-1.0])
	libusb_static_libdir=`$PKG_CONFIG --variable=libdir libusb-1.0`
	libusb_static_archive="$libusb_static_libdir/libusb-1.0.a"
	AS_IF([test -f "$libusb_static_archive"], [], [
		AC_MSG_ERROR([standalone build requested but libusb static archive was not found: $libusb_static_archive])
	])
	LIBUSB1_LIBS=`$PKG_CONFIG --libs --static libusb-1.0 | sed "s|-lusb-1.0|$libusb_static_archive|"`
	case "$host_os" in
		mingw*|msys*)
			LDFLAGS="$LDFLAGS -static -static-libgcc -static-libstdc++"
			AC_MSG_NOTICE([standalone MinGW build enabled: linking GCC and C++ runtimes statically])
			;;
	esac
	AC_MSG_NOTICE([standalone build enabled: linking libusb from $libusb_static_archive])
], [
	PKG_CHECK_MODULES([LIBUSB1], [libusb-1.0])
])

AC_CONFIG_FILES([Makefile])

AC_OUTPUT
