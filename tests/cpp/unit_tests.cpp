#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

#define main rkdeveloptool_cli_main
#include "../../main.cpp"
#undef main

namespace {

int failures = 0;

void expect_true(bool condition, const char *message)
{
	if (!condition) {
		std::cerr << "FAIL: " << message << std::endl;
		failures++;
	}
}

void expect_false(bool condition, const char *message)
{
	expect_true(!condition, message);
}

template <typename T, typename U>
void expect_eq(const T &actual, const U &expected, const char *message)
{
	if (!(actual == expected)) {
		std::cerr << "FAIL: " << message << " expected=" << expected
			  << " actual=" << actual << std::endl;
		failures++;
	}
}

void test_parse_config()
{
	char config[] =
		"  # ignored\r\n"
		"loader = /tmp/loader.bin\r\n"
		" image = /tmp/image.img \n"
		"broken-line\n";
	CONFIG_ITEM_VECTOR items;

	expect_true(parse_config(config, items), "parse_config accepts valid text");
	expect_eq(items.size(), static_cast<size_t>(2), "parse_config keeps only key/value lines");
	expect_eq(std::string(items[0].szItemName), std::string("loader"), "parse_config trims item names");
	expect_eq(std::string(items[0].szItemValue), std::string("/tmp/loader.bin"), "parse_config trims item values");
	expect_eq(find_config_item(items, "IMAGE"), 1, "find_config_item is case-insensitive");
	expect_eq(find_config_item(items, "missing"), -1, "find_config_item reports missing names");
}

void test_parse_partition_info()
{
	std::string part = " 0x00002000 @ 0x00004000 ( boot ) ";
	std::string name;
	UINT offset = 0;
	UINT len = 0;

	expect_true(ParsePartitionInfo(part, name, offset, len), "ParsePartitionInfo accepts a normal partition");
	expect_eq(name, std::string("boot"), "ParsePartitionInfo trims partition names");
	expect_eq(offset, static_cast<UINT>(0x4000), "ParsePartitionInfo parses offsets");
	expect_eq(len, static_cast<UINT>(0x2000), "ParsePartitionInfo parses lengths");

	part = "-@0x00006000(rootfs)";
	expect_true(ParsePartitionInfo(part, name, offset, len), "ParsePartitionInfo accepts open-ended partitions");
	expect_eq(name, std::string("rootfs"), "ParsePartitionInfo parses open-ended names");
	expect_eq(offset, static_cast<UINT>(0x6000), "ParsePartitionInfo parses open-ended offsets");
	expect_eq(len, static_cast<UINT>(0xffffffff), "ParsePartitionInfo maps '-' length to 0xffffffff");

	part = "0x1000(rootfs)";
	expect_false(ParsePartitionInfo(part, name, offset, len), "ParsePartitionInfo rejects missing offsets");
}

void test_parse_uuid_info()
{
	std::string uuid_info = " rootfs = 12345678-1234-5678-9abc-def012345678 ";
	std::string name;
	std::string uuid;

	expect_true(ParseUuidInfo(uuid_info, name, uuid), "ParseUuidInfo accepts dashed UUIDs");
	expect_eq(name, std::string("rootfs"), "ParseUuidInfo trims UUID names");
	expect_eq(uuid, std::string("12345678123456789abcdef012345678"), "ParseUuidInfo removes dashes");

	uuid_info = "rootfs=1234";
	expect_false(ParseUuidInfo(uuid_info, name, uuid), "ParseUuidInfo rejects invalid UUID length");
}

void test_parse_parameter_and_lookup()
{
	char parameter[] =
		"FIRMWARE_VER:8.1\n"
		"CMDLINE:mtdparts=rk29xxnand:"
		"0x00002000@0x00004000(loader),"
		"0x00001000@0x00006000(boot),"
		"-@0x00007000(rootfs)\n"
		"uuid:rootfs=12345678-1234-5678-9abc-def012345678\n";
	PARAM_ITEM_VECTOR parts;
	CONFIG_ITEM_VECTOR uuids;

	expect_true(parse_parameter(parameter, parts, uuids), "parse_parameter finds mtdparts");
	expect_eq(parts.size(), static_cast<size_t>(3), "parse_parameter extracts all partitions");
	expect_eq(std::string(parts[0].szItemName), std::string("loader"), "parse_parameter keeps loader name");
	expect_eq(parts[0].uiItemOffset, static_cast<UINT>(0x4000), "parse_parameter keeps loader offset");
	expect_eq(parts[0].uiItemSize, static_cast<UINT>(0x2000), "parse_parameter keeps loader size");
	expect_eq(std::string(parts[2].szItemName), std::string("rootfs"), "parse_parameter keeps rootfs name");
	expect_eq(parts[2].uiItemSize, static_cast<UINT>(0xffffffff), "parse_parameter keeps open-ended partition size");
	expect_eq(uuids.size(), static_cast<size_t>(1), "parse_parameter extracts UUID entries");
	expect_eq(std::string(uuids[0].szItemName), std::string("rootfs"), "parse_parameter keeps UUID partition name");

	u32 offset = 0;
	u32 size = 0;
	expect_true(get_lba_from_param(reinterpret_cast<u8 *>(parameter), const_cast<char *>("BOOT"), &offset, &size),
		    "get_lba_from_param is case-insensitive");
	expect_eq(offset, static_cast<u32>(0x6000), "get_lba_from_param returns matching offset");
	expect_eq(size, static_cast<u32>(0x1000), "get_lba_from_param returns matching size");

	char invalid[] = "CMDLINE:no-partition-table\n";
	expect_false(parse_parameter(invalid, parts, uuids), "parse_parameter rejects text without mtdparts");
}

void test_split_item()
{
	char items[] = "loader,image,rootfs";
	STRING_VECTOR split;

	split_item(split, items);
	expect_eq(split.size(), static_cast<size_t>(3), "split_item returns each comma-separated item");
	expect_eq(split[0], std::string("loader"), "split_item keeps first item");
	expect_eq(split[2], std::string("rootfs"), "split_item keeps last item");
}

void test_crc32_le()
{
	unsigned char text[] = "123456789";

	expect_eq(crc32_le(0, text, 9), 0xcbf43926U, "crc32_le matches standard CRC-32 test vector");
	expect_eq(crc32_le(0, text, 0), 0U, "crc32_le handles empty buffers");
}

void test_check_device_type()
{
	STRUCT_RKDEVICE_DESC dev;
	memset(&dev, 0, sizeof(dev));
	dev.emUsbType = RKUSB_MASKROM;

	expect_true(check_device_type(dev, RKUSB_MASKROM | RKUSB_LOADER),
		    "check_device_type accepts a supported USB type");
}

}

int main()
{
	test_parse_config();
	test_parse_partition_info();
	test_parse_uuid_info();
	test_parse_parameter_and_lookup();
	test_split_item();
	test_crc32_le();
	test_check_device_type();

	if (failures != 0) {
		std::cerr << failures << " C++ unit test failure(s)" << std::endl;
		return EXIT_FAILURE;
	}
	std::cout << "C++ unit tests passed" << std::endl;
	return EXIT_SUCCESS;
}
