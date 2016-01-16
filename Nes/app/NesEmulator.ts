﻿///<reference path="CompoundMemory.ts"/>
///<reference path="RAM.ts"/>
///<reference path="NesImage.ts"/>
///<reference path="Mos6502.ts"/>
class NesEmulator {
    public cpu: Mos6502;
    public memory: CompoundMemory;
    public vmemory: Memory;
    public ppu: PPU;

    public constructor(nesImage: NesImage) {
        var ip = 0;
        switch (nesImage.mapperType)
        {
            case 0:
                if (nesImage.ROMBanks.length === 1) {
                    this.memory = new CompoundMemory(
                            new RAM(0xc000),
                            nesImage.ROMBanks[0]);
                    ip = 0xc000;
                }
                else if (nesImage.ROMBanks.length === 2) {
                    this.memory = new CompoundMemory(
                        new RAM(0x8000),
                        nesImage.ROMBanks[0],
                        nesImage.ROMBanks[1]);

                    ip = this.memory.getByte(0xfffc) + 256 * this.memory.getByte(0xfffd);
                }

                if (nesImage.VRAMBanks.length > 1 || nesImage.VRAMBanks[0].size() !== 0x2000)
                    throw 'unknown VRAMBanks';

                var patternTable = nesImage.VRAMBanks.length > 0 ? nesImage.VRAMBanks[0] : new RAM(0x2000);
                var nameTableA = new RAM(0x400);
                var nameTableB = new RAM(0x400);
                var nameTableC = nesImage.fFourScreenVRAM ? new RAM(0x400) : nesImage.fVerticalMirroring ? nameTableA : nameTableB;
                var nameTableD = nesImage.fFourScreenVRAM ? new RAM(0x400) : nesImage.fVerticalMirroring ? nameTableB : nameTableA;
                var rest = new RAM(0x1000);

                this.vmemory = new CompoundMemory(patternTable, nameTableA, nameTableB, nameTableC, nameTableD, rest);
                break;
            case 1:
                var mmc1 = new MMC1(nesImage.ROMBanks, nesImage.VRAMBanks);
                this.memory = mmc1.memory;
                this.vmemory = mmc1.vmemory;
                ip = this.memory.getByte(0xfffc) + 256 * this.memory.getByte(0xfffd);
        }

        if (!this.memory)
            throw 'unkown mapper ' + nesImage.mapperType;
        this.ppu = new PPU(this.memory, this.vmemory);
        this.cpu = new Mos6502(this.memory, ip, 0xfd);
    }
    public step() {
        this.cpu.step();
    }

}