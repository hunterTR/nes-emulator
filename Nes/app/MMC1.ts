///<reference path="Memory.ts"/>
///<reference path="RAM.ts"/>
///<reference path="CompoundMemory.ts"/>
class MMC1 {

   /**
    *  $8000-9FFF:  [...C PSMM]
        C = CHR Mode (0=8k mode, 1=4k mode)
        P = PRG Size (0=32k mode, 1=16k mode)
        S = Slot select:
            0 = $C000 swappable, $8000 fixed to page $00 (mode A)
            1 = $8000 swappable, $C000 fixed to page $0F (mode B)
            This bit is ignored when 'P' is clear (32k mode)
        M = Mirroring control:
            %00 = 1ScA
            %01 = 1ScB
            %10 = Vert
            %11 = Horz


      $A000-BFFF:  [...C CCCC]
        CHR Reg 0

      $C000-DFFF:  [...C CCCC]
        CHR Reg 1

      $E000-FFFF:  [...W PPPP]
        W = WRAM Disable (0=enabled, 1=disabled)
        P = PRG Reg

    */
    r0:number = 0;
    r1: number = 0;
    r2: number = 0;
    r3: number = 0;

    iWrite: number = 0;
    rTemp: number = 0;

    private getFlg(flgs, iFirst, iLast = null): number {
        if (iLast === null)
            return (flgs >> iFirst) & 1;
        else 
            return (flgs >> iFirst) & ((1 << (iLast-iFirst)) - 1);
    }

    get C(): number { return this.getFlg(this.r0, 4) ; }
    get P(): number { return this.getFlg(this.r0, 3); }
    get S(): number { return this.getFlg(this.r0, 2); }
    get M(): number { return this.getFlg(this.r0, 0, 1); }
    get CHR0(): number { return this.getFlg(this.r1, 0, 4); }
    get CHR1(): number { return this.getFlg(this.r2, 0, 4); }
    get PRG0(): number { return this.getFlg(this.r3, 0, 3); }
    get W(): number { return this.getFlg(this.r3, 4); }

    memory: CompoundMemory;
    private vmemory: CompoundMemory;
    private nametable:CompoundMemory;
    private nametableA:RAM;
    private nametableB:RAM;
    private palette:RAM;

    constructor(private PRGBanks: Memory[], private VROMBanks: Memory[]) {
        while (PRGBanks.length < 2)
            PRGBanks.push(new RAM(0x4000));

        while (VROMBanks.length < 2)
            VROMBanks.push(new RAM(0x100));

        this.memory = new CompoundMemory(
            new RAM(0x8000),
            PRGBanks[0],
            PRGBanks[1]
        );

        this.nametableA = new RAM(0x100);
        this.nametableB = new RAM(0x100);
        this.palette = new RAM(0x20);
        this.nametable = new CompoundMemory(this.nametableA, this.nametableA, this.nametableB, this.nametableB);
       
      
        
        this.vmemory = new CompoundMemory(
            VROMBanks[0],
            VROMBanks[1],
            new RepeatedMemory(2, this.nametable),
            new RepeatedMemory(8, this.palette)
        );

        this.memory.shadowSetter(0x8000, 0xffff, this.setByte.bind(this));
        this.memory.shadowSetter(0x2000, 0x7999, (addr: number) => {
            console.log(addr.toString(16));
        });
    }

    private setByte(addr: number, value: number): void {
        /*Temporary reg port ($8000-FFFF):
            [r... ...d]
                r = reset flag
                d = data bit

        When 'r' is set:
            - 'd' is ignored
            - hidden temporary reg is reset (so that the next write is the "first" write)
            - bits 2,3 of reg $8000 are set (16k PRG mode, $8000 swappable)
            - other bits of $8000 (and other regs) are unchanged

        When 'r' is clear:
            - 'd' proceeds as the next bit written in the 5-bit sequence
            - If this completes the 5-bit sequence:
                - temporary reg is copied to actual internal reg (which reg depends on the last address written to)
                - temporary reg is reset (so that next write is the "first" write)
        */
        value &= 0xff;
        var flgReset = value >> 7;
        var flgData = value & 0x1;
        if (flgReset === 1) {
            this.rTemp = 0;
            this.P = 1;
            this.S = 1;
            this.iWrite = 0;
        } else {
            this.rTemp = (this.rTemp << 1) + flgData;
            this.iWrite++;
            if (this.iWrite === 5) {
                if (addr <= 0x9fff)
                    this.r0 = this.rTemp;
                else if (addr <= 0xbfff)
                    this.r1 = this.rTemp;
                else if (addr <= 0xdfff)
                    this.r2 = this.rTemp;
                else if (addr <= 0xffff)
                    this.r3 = this.rTemp;
                this.update();
            }
        }
    }

    private update() {
        /*
          P = PRG Size (0=32k mode, 1=16k mode)
          S = Slot select:
            0 = $C000 swappable, $8000 fixed to page $00 (mode A)
            1 = $8000 swappable, $C000 fixed to page $0F (mode B)
            This bit is ignored when 'P' is clear (32k mode)*/

        if (this.P === 1) {
            this.memory.rgmemory[1] = this.PRGBanks[this.PRG0 >> 1];
            this.memory.rgmemory[2] = this.PRGBanks[(this.PRG0 >> 1) + 1];
        }
        else if (this.S === 0) {
            this.memory.rgmemory[1] = this.PRGBanks[0];
            this.memory.rgmemory[2] = this.PRGBanks[this.PRG0];
        }
        else {
            this.memory.rgmemory[1] = this.PRGBanks[this.PRG0];
            this.memory.rgmemory[2] = this.PRGBanks[0x0f];
        }
    }
}