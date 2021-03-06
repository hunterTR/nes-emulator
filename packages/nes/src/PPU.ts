import {Mos6502} from './cpu/Mos6502';
import {Driver} from './driver/Driver';
import {CompoundMemory} from './memory/CompoundMemory';
class SpriteRenderingInfo {
    public flgZeroSprite: boolean = false;
    public xCounter: number = -1000;
    public tileLo: number = 0;
    public tileHi: number = 0;
    public ipaletteBase: number = 0;
    public flipHoriz: boolean = false;
    public flipVert: boolean = false;
    public behindBg: boolean = false;
}

enum OamState {
    FillSecondaryOam,
    CheckOverflow,
    Done,
}

export class PPU {

     private static syFirstVisible = 0;
     private static sxMin = 0;

     public nmiOutput = false;
     public iFrame = 0;

     private addrOam: number = 0;

     /*

      Address range    Size    Description
      $0000-$0FFF    $1000    Pattern table 0
      $1000-$1FFF    $1000    Pattern Table 1
      $2000-$23FF    $0400    Nametable 0
      $2400-$27FF    $0400    Nametable 1
      $2800-$2BFF    $0400    Nametable 2
      $2C00-$2FFF    $0400    Nametable 3
      $3000-$3EFF    $0F00    Mirrors of $2000-$2EFF
      $3F00-$3F1F    $0020    Palette RAM indexes
      $3F20-$3FFF    $00E0    Mirrors of $3F00-$3F1F

      */
     /*
      The PPU uses the current VRAM address for both reading and writing PPU memory thru $2007, and for
      fetching nametable data to draw the background. As it's drawing the background, it updates the
      address to point to the nametable data currently being drawn. Bits 10-11 hold the base address of
      the nametable minus $2000. Bits 12-14 are the Y offset of a scanline within a tile.

      The 15 bit registers t and v are composed this way during rendering:
      yyy NN YYYYY XXXXX
      ||| || ||||| +++++-- coarse X scroll
      ||| || +++++-------- coarse Y scroll
      ||| ++-------------- nametable select
      +++----------------- fine Y scroll
      */
     private v: number = 0; // Current VRAM address (15 bits)
     private t: number = 0; // Temporary VRAM address (15 bits); can also be thought of as the address of the top left onscreen tile.
     private x: number = 0; // Fine X scroll (3 bits)
     private w: number = 0; // First or second write toggle (1 bit)
     private nt: number = 0; // current nametable byte;
     private at: number = 0; // current attribute table byte;
     private p2: number = 0; // current palette table byte;
     private p3: number = 0; // current palette table byte;
     private bgTileLo: number = 0; // low background tile byte

     private bgTileHi: number = 0; // high background tile byte;
     private daddrWrite: number = 0;
     private addrSpriteBase: number = 0;

     private addrTileBase: number = 0;
     private flgVblank = false;
     private flgVblankSuppress = false;
     private flgSpriteZeroHit = false;
     private flgSpriteOverflow = false;

     private spriteHeight = 8;

     private imageGrayscale = false;
     private showBgInLeftmost8Pixels = false;
     private showSpritesInLeftmost8Pixels = false;
     private showBg = false;
     private showSprites = false;
     private emphasizeRed = false;
     private emphasizeGreen = false;
     private emphasizeBlue = false;

     private sy = PPU.syFirstVisible;
     private sx = PPU.sxMin;

     private renderer: Driver;
     private data: Uint32Array;
     private dataAddr = 0;

     private secondaryOam: Uint8Array;
     private secondaryOamISprite: Int8Array;
     private oam: Uint8Array;
     private rgspriteRenderingInfo: SpriteRenderingInfo[];
     private ispriteNext = 0;
     private palette = [
         0x09, 0x01, 0x00, 0x01, 0x00, 0x02, 0x02, 0x0D, 0x08, 0x10, 0x08, 0x24, 0x00, 0x00, 0x04, 0x2C,
         0x09, 0x01, 0x34, 0x03, 0x00, 0x04, 0x00, 0x14, 0x08, 0x3A, 0x00, 0x02, 0x00, 0x20, 0x2C, 0x08,
     ];

     private lastWrittenStuff: number = 0;
     private vramReadBuffer: number = 0;

     private shortFrame = false;

     private colors = new Uint32Array([
         0xff545454, 0xff741e00, 0xff901008, 0xff880030,
         0xff640044, 0xff30005c, 0xff000454, 0xff00183c,
         0xff002a20, 0xff003a08, 0xff004000, 0xff003c00,
         0xff3c3200, 0xff000000, 0xff000000, 0xff000000,
         0xff989698, 0xffc44c08, 0xffec3230, 0xffe41e5c,
         0xffb01488, 0xff6414a0, 0xff202298, 0xff003c78,
         0xff005a54, 0xff007228, 0xff007c08, 0xff287600,
         0xff786600, 0xff000000, 0xff000000, 0xff000000,
         0xffeceeec, 0xffec9a4c, 0xffec7c78, 0xffec62b0,
         0xffec54e4, 0xffb458ec, 0xff646aec, 0xff2088d4,
         0xff00aaa0, 0xff00c474, 0xff20d04c, 0xff6ccc38,
         0xffccb438, 0xff3c3c3c, 0xff000000, 0xff000000,
         0xffeceeec, 0xffeccca8, 0xffecbcbc, 0xffecb2d4,
         0xffecaeec, 0xffd4aeec, 0xffb0b4ec, 0xff90c4e4,
         0xff78d2cc, 0xff78deb4, 0xff90e2a8, 0xffb4e298,
         0xffe4d6a0, 0xffa0a2a0, 0xff000000, 0xff000000,
     ]);

     private d: number;
     private oamB: number;
     private copyToSecondaryOam: number;
     private addrSecondaryOam: number;
     private oamState: OamState;
     /*
      yyy NN YYYYY XXXXX
      ||| || ||||| +++++-- coarse X scroll
      ||| || +++++-------- coarse Y scroll
      ||| ++-------------- nametable select
      +++----------------- fine Y scroll
      */

     get y() {
         return (this.t >> 12) & 0x7;
     }

     get currentNameTable() {
         return (this.t >> 10) & 0x3;
     }

     get coarseY() {
         return (this.t >> 5) & 31;
     }

     set coarseY(value: number) {
         this.t = (this.t & 0x7c1f) | ((value & 31) << 5);
     }

     get coarseX() {
         return this.t & 31;
     }

     set coarseX(value: number) {
         this.t = (this.t & 0x7fe0) | ((value & 31));
     }

     constructor(memory: CompoundMemory, public vmemory: CompoundMemory, private cpu: Mos6502) {
         if (vmemory.size() !== 0x4000) {
             throw new Error('insufficient Vmemory size');
         }

         memory.shadowSetter(0x2000, 0x3fff, this.ppuRegistersSetter.bind(this));
         memory.shadowGetter(0x2000, 0x3fff, this.ppuRegistersGetter.bind(this));

         vmemory.shadowSetter(0x3000, 0x3eff, this.nameTableSetter.bind(this));
         vmemory.shadowGetter(0x3000, 0x3eff, this.nameTableGetter.bind(this));

         vmemory.shadowSetter(0x3f00, 0x3fff, this.paletteSetter.bind(this));
         vmemory.shadowGetter(0x3f00, 0x3fff, this.paletteGetter.bind(this));

         this.secondaryOam = new Uint8Array(32);
         this.secondaryOamISprite = new Int8Array(8);
         this.oam = new Uint8Array(256);
         this.rgspriteRenderingInfo = [];
         for (let isprite = 0; isprite < 8; isprite++) {
             this.rgspriteRenderingInfo.push(new SpriteRenderingInfo());
         }
     }

     public setDriver(renderer: Driver) {
         this.renderer = renderer;
         this.data = this.renderer.getBuffer();
     }

     public getPixelColor(x: number, y: number) {
         return this.data[y * 256 + x];
     }

     public getNameTable(i: number) {
         let st = '';
         for (let y = 0; y < 30; y++) {
             for (let x = 0; x < 32; x++) {
                 st += String.fromCharCode(this.vmemory.getByte(0x2000 + (i * 0x400) + x + y * 32));
             }
             st += '\n';
         }
         return st;
     }

     public getPatternTable() {
         const canvas: HTMLCanvasElement = document.createElement('canvas');
         canvas.width = 256;
         canvas.height = 128;
         const ctx = canvas.getContext('2d');
         const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
         const buf = new ArrayBuffer(imageData.data.length);
         const buf8 = new Uint8ClampedArray(buf);
         const data = new Uint32Array(buf);

         for (let t = 0; t < 2; t++) {
             for (let a = 0; a < 256; a++) {
                 for (let x = 0; x < 8; x++) {
                     for (let y = 0; y < 8; y++) {
                         const irow = (a >> 4) * 8 + y;
                         const icol = 128 * t + (a & 15) * 8 + x;

                         const b1 = (this.vmemory.getByte(t * 0x1000 + a * 16 + y) >> (7 - x)) & 1;
                         const b2 = (this.vmemory.getByte(t * 0x1000 + a * 16 + y + 8) >> (7 - x)) & 1;
                         data[irow * 256 + icol] = this.colors[this.paletteGetter(0x3f00 | (b2 << 1) | b1)];
                     }
                 }
             }
         }

         (imageData.data as any).set(buf8);
         ctx.putImageData(imageData, 0, 0);
         document.body.appendChild(canvas);

     }

     public getAttributeTable(i: number) {
         let st = '';
         for (let dy = 0; dy < 30; dy += 2) {
             for (let dx = 0; dx < 32; dx += 2) {
                 const x = this.coarseX + dx;
                 const y = this.coarseY + dy;

                 const addr = 0x23C0 | (i << 10) | (((y >> 2) & 0x07) << 3) | ((x >> 2) & 0x07);
                 const at = this.vmemory.getByte(addr);
                 const x2 = (x >> 1) & 1; // second bit of coarse x
                 const y2 = (y >> 1) & 1; // second bit of coarse y

                 const p = (at >> ((y2 << 2) + (x2 << 1))) & 3;
                 st += p + ' ';
             }
             st += '\n';
         }
         console.log(st);
     }

     public step() {
         this.stepDraw();

         this.stepOam();

         this.stepBg();
         this.stepS();

         this.flgVblankSuppress = false;
     }

     private nameTableSetter(addr: number, value: number) {
         return this.vmemory.setByte(addr - 0x1000, value);
     }

     private nameTableGetter(addr: number) {
         return this.vmemory.getByte(addr - 0x1000);
     }

     private paletteSetter(addr: number, value: number) {
         if (addr === 0x3f10) {
             addr = 0;
         } else {
             addr &= 0x1f;
         }
         return this.palette[addr] = value & 0x3f;
     }

     private paletteGetter(addr: number) {
         if (addr === 0x3f10) {
             addr = 0;
         } else {
             addr &= 0x1f;
         }
         return this.palette[addr];

     }

     private ppuRegistersGetter(addr: number) {

         addr = (addr - 0x2000) % 8;
         switch (addr) {
             case 0x2: {
                 /*
                  7  bit  0
                  ---- ----
                  VSO. ....
                  |||| ||||
                  |||+-++++- Least significant bits previously written into a PPU register
                  |||        (due to register not being updated for this address)
                  ||+------- Sprite overflow. The intent was for this flag to be set
                  ||         whenever more than eight sprites appear on a scanline, but a
                  ||         hardware bug causes the actual behavior to be more complicated
                  ||         and generate false positives as well as false negatives; see
                  ||         PPU sprite evaluation. This flag is set during sprite
                  ||         evaluation and cleared at dot 1 (the second dot) of the
                  ||         pre-render line.
                  |+-------- Sprite 0 Hit.  Set when a nonzero pixel of sprite 0 overlaps
                  |          a nonzero background pixel; cleared at dot 1 of the pre-render
                  |          line.  Used for raster timing.
                  +--------- Vertical blank has started (0: not in vblank; 1: in vblank).
                  Set at dot 1 of line 241 (the line *after* the post-render
                  line); cleared after reading $2002 and at dot 1 of the
                  pre-render line.
                  Notes
                  Reading the status register will clear D7 mentioned above and also the address latch used by PPUSCROLL
                  and PPUADDR. It does not clear the sprite 0 hit or overflow bit.
                  Once the sprite 0 hit flag is set, it will not be cleared until the end of the next vertical blank.
                  If attempting to use this flag for raster timing, it is important to ensure that the sprite 0 hit check
                  happens outside of vertical blank, otherwise the CPU will "leak" through and the check will fail. The
                  easiest way to do this is to place an earlier check for D6 = 0, which will wait for the pre-render scanline
                  to begin.
                  If using sprite 0 hit to make a bottom scroll bar below a vertically scrolling or freely scrolling playfield,
                  be careful to ensure that the tile in the playfield behind sprite 0 is opaque.
                  Sprite 0 hit is not detected at x=255, nor is it detected at x=0 through 7 if the background or sprites are
                  hidden in this area.
                  See: PPU rendering for more information on the timing of setting and clearing the flags.
                  Some Vs. System PPUs return a constant value in D4-D0 that the game checks.
                  Caution: Reading PPUSTATUS at the exact start of vertical blank will return 0 in bit 7 but clear the latch
                  anyway, causing the program to miss frames. See NMI for details
                  */
                 this.w = 0;

                 const res = (this.flgVblank ? (1 << 7) : 0)
                         | (this.flgSpriteZeroHit ? (1 << 6) : 0)
                         | (this.flgSpriteOverflow ? (1 << 5) : 0)
                         | (this.lastWrittenStuff & 31)
                     ;
                 // Read PPUSTATUS: Return old status of NMI_occurred in bit 7, then set NMI_occurred to false.
                 this.flgVblank = false;
                 // suppress setting flgVBlank in next ppu cycle
                 //   http://wiki.nesdev.com/w/index.php/PPU_frame_timing#VBL_Flag_Timing
                 this.flgVblankSuppress = true;
                 this.cpu.nmiLine = 1;

                 return res;
             }
             case 0x4: {
                 return this.oam[this.addrOam & 0xff];
             }
             case 0x7: {
                 this.v &= 0x3fff;
                 let res: number;
                 if (this.v >= 0x3f00) {
                     res = this.vmemory.getByte(this.v);
                     this.vramReadBuffer = this.vmemory.getByte((this.v & 0xff) | 0x2f00);
                 } else {
                     res = this.vramReadBuffer;
                     this.vramReadBuffer = this.vmemory.getByte(this.v);
                 }

                 this.v += this.daddrWrite;
                 this.v &= 0x3fff;
                 this.triggerMemoryAccess(this.v);
                 return res;
             }
             default:
                 console.error('unimplemented read from addr ' + addr);
                 return 0;
         }
     }

     private ppuRegistersSetter(addr: number, value: number) {
         this.lastWrittenStuff = value;

         value &= 0xff;
         addr = (addr - 0x2000) % 8;

         switch (addr) {
             case 0x0:
                 this.t = (this.t & 0x73ff) | ((value & 3) << 10); // 2 nametable select bits sent to $2000
                 this.daddrWrite = value & 0x04 ? 32 : 1; // VRAM address increment per CPU read/write of PPUDATA
                 this.addrSpriteBase = value & 0x08 ? 0x1000 : 0;
                 this.addrTileBase = value & 0x10 ? 0x1000 : 0;
                 this.spriteHeight = value & 0x20 ? 16 : 8;
                 const nmiOutputNew = !!(value & 0x80);

                 if (!nmiOutputNew) {
                     this.cpu.nmiLine = 1;
                 }

                 if (this.sy === 261 && this.sx === 1) {
                     this.flgVblank = false;
                 }

                 if (!this.nmiOutput && nmiOutputNew && this.flgVblank) {
                     this.cpu.nmiLine = 0;
                 }

                 this.nmiOutput = nmiOutputNew;

                 break;
             case 0x1:
                 this.imageGrayscale = !!(value & 0x01);
                 this.showBgInLeftmost8Pixels = !!(value & 0x02);
                 this.showSpritesInLeftmost8Pixels = !!(value & 0x04);
                 this.showBg = !!(value & 0x08);
                 this.showSprites = !!(value & 0x10);
                 this.emphasizeRed = !!(value & 0x20);
                 this.emphasizeGreen = !!(value & 0x40);
                 this.emphasizeBlue = !!(value & 0x80);

                 break;
             case 0x3:
                 this.addrOam = value;
                 break;
             case 0x4:
                 if ((this.showBg || this.showSprites) && (this.sy === 261 || this.sy < 240)) {
                     this.addrOam += 4;
                 } else {
                     this.oam[this.addrOam & 0xff] = value;
                     this.addrOam++;
                 }
                 this.addrOam &= 255;

                 break;
             case 0x5:
                 if (this.w === 0) {
                     this.t = (this.t & 0x7fe0) | ((value >> 3) & 0x1f);
                     this.x = value & 7;
                 } else {
                     this.t = (this.t & 0x7c1f) | (((value >> 3) & 0x1f) << 5);
                     this.t = (this.t & 0x0fff) | (value & 7) << 12;
                 }
                 this.w = 1 - this.w;
                 break;

             // Used to set the address of PPU Memory to be accessed via 0x2007
             // The first write to this register will set 8 lower address bits.
             // The second write will set 6 upper bits.The address will increment
             // either by 1 or by 32 after each access to $2007.
             case 0x6:

                 if (this.w === 0) {
                     this.t = (this.t & 0x00ff) | ((value & 0x3f) << 8);
                 } else {
                     this.t = (this.t & 0xff00) + (value & 0xff);
                     this.v = this.t;
                     this.triggerMemoryAccess(this.v);
                 }
                 this.w = 1 - this.w;

                 break;
             case 0x7:
                 this.setByte(this.v & 0x3fff, value);
                 this.v += this.daddrWrite;
                 this.v &= 0x3fff;
                 this.triggerMemoryAccess(this.v);
                 break;
         }
     }

     private resetHoriV() {

         if (!this.showBg && !this.showSprites) {
             return;
         }

         // At dot 257 of each scanline
         // If rendering is enabled, the PPU copies all bits related to horizontal position from t to v:
         // v: ....F.. ...EDCBA = t: ....F.. ...EDCBA
         this.v = (this.v & 0xfbe0) | (this.t & 0x041f);
     }

     private resetVertV() {
         if (!this.showBg && !this.showSprites) {
             return;
         }

         // During dots 280 to 304 of the pre-render scanline (end of vblank)
         // If rendering is enabled, at the end of vblank, shortly after the horizontal bits are copied from t to v at
         // dot 257, the PPU will repeatedly copy the vertical bits from t to v from dots 280 to 304, completing the
         // full initialization of v from t:
         // v: IHGF.ED CBA..... = t: IHGF.ED CBA.....
         this.v = (this.v & 0x041f) | (this.t & 0xfbe0);
     }

     private incHoriV() {
         if (!this.showBg && !this.showSprites) {
             return;
         }

         // Coarse X increment
         // The coarse X component of v needs to be incremented when the next tile is reached.
         // Bits 0- 4 are incremented, with overflow toggling bit 10. This means that bits 0- 4 count
         // from 0 to 31 across a single nametable, and bit 10 selects the current nametable horizontally.

         if ((this.v & 0x001F) === 31) { // if coarse X == 31
             this.v &= ~0x001F; // coarse X = 0
             this.v ^= 0x0400; // switch horizontal nametable
         } else {
             this.v += 1; // increment coarse X
         }
     }

     private incVertV() {

         if (!this.showBg && !this.showSprites) {
             return;
         }

         this.v = (this.v & ~0x001F) | (this.t & 0x1f); // reset coarse X
         this.v ^= 0x0400; // switch horizontal nametable

         // If rendering is enabled, fine Y is incremented at dot 256 of each scanline, overflowing to coarse Y,
         // and finally adjusted to wrap among the nametables vertically.
         // Bits 12- 14 are fine Y.Bits 5- 9 are coarse Y.Bit 11 selects the vertical nametable.
         if ((this.v & 0x7000) !== 0x7000) { // if fine Y < 7
             this.v += 0x1000; // increment fine Y
         } else {
             this.v &= ~0x7000; // fine Y = 0

             let y = (this.v & 0x03E0) >> 5; // let y = coarse Y
             if (y === 29) {
                 y = 0; // coarse Y = 0
                 this.v ^= 0x0800; // switch vertical nametable
             } else if (y === 31) {
                 y = 0; // coarse Y = 0, nametable not switched
             } else {
                 y += 1; // increment coarse Y
             }
             this.v = (this.v & ~0x03E0) | (y << 5); // put coarse Y back into v
             /* Row 29 is the last row of tiles in a nametable. To wrap to the next nametable when incrementing coarse Y from 29,
              the vertical nametable is switched by toggling bit 11, and coarse Y wraps to row 0.
              Coarse Y can be set out of bounds (> 29), which will cause the PPU to read the attribute data stored there as tile data.
              If coarse Y is incremented from 31, it will wrap to 0, but the nametable will not switch.
              For this reason, a write >= 240 to $2005 may appear as a "negative" scroll value, where 1 or 2 rows of attribute data will
              appear before the nametable's tile data is reached.
              */
         }
     }

     private fetchUnusedNt(phase: boolean) {
         if (!this.showBg && !this.showSprites) {
             return;
         }

         this.getByte(0x2000 | (this.v & 0x0fff), phase);
     }

     private fetchNt(phase: boolean) {
         if (!this.showBg && !this.showSprites) {
             return;
         }

         if (this.getByte(0x2000 | (this.v & 0x0fff), phase)) {
             this.nt = this.d;
         }
     }

     private fetchAt(phase: boolean) {
         if (!this.showBg && !this.showSprites) {
             return;
         }
         const addr = 0x23C0 | (this.v & 0x0C00) | ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07);
         if (this.getByte(addr, phase)) {
             this.at = this.d;

             const dx = (this.v >> 1) & 1; // second bit of coarse x
             const dy = (this.v >> 6) & 1; // second bit of coarse y

             const p = (this.at >> ((dy << 2) + (dx << 1))) & 3;

             this.p2 = (this.p2 & 0xffff00) | (p & 1 ? 0xff : 0);
             this.p3 = (this.p3 & 0xffff00) | (p & 2 ? 0xff : 0);
         }
     }

     private fetchSpriteTileLo(yTop: number, nt: number, flipVert: boolean, phase: boolean) {
         if (!this.showSprites) {
             return 0;
         }
         if (this.spriteHeight === 8) {
             const y = flipVert ? 7 - (this.sy - yTop) : this.sy - yTop;
             if (this.getByte(this.addrSpriteBase + (nt << 4) + y, phase)) {
                 return this.d;
             }
         } else {
             const y = flipVert ? 15 - (this.sy - yTop) : this.sy - yTop;
             let addrBase = nt & 1 ? 0x1000 : 0;
             if (y > 7) {
                 addrBase += 8;
             }
             if (this.getByte(addrBase + ((nt >> 1) << 5) + 0 + y, phase)) {
                 return this.d;
             }
         }
         return 0;
     }

     private fetchSpriteTileHi(yTop: number, nt: number, flipVert: boolean, phase: boolean) {
         if (!this.showSprites) {
             return 0;
         }

         if (this.spriteHeight === 8) {
             const y = flipVert ? 7 - (this.sy - yTop) : this.sy - yTop;
             if (this.getByte(this.addrSpriteBase + (nt << 4) + 8 + y, phase)) {
                 return this.d;
             }
         } else {

             const y = flipVert ? 15 - (this.sy - yTop) : this.sy - yTop;
             let addrBase = nt & 1 ? 0x1000 : 0;
             if (y > 7) {
                 addrBase += 8;
             }
             if (this.getByte(addrBase + ((nt >> 1) << 5) + 8 + y, phase)) {
                 return this.d;
             }
         }

         return 0;
     }

     private fetchBgTileLo(phase: boolean) {
         if (!this.showBg && !this.showSprites) {
             return;
         }

         const y = (this.v >> 12) & 0x07;
         if (this.getByte(this.addrTileBase + (this.nt << 4) + y, phase)) {
             this.bgTileLo = (this.d & 0xff) | (this.bgTileLo & 0xffff00);
         }
     }

     private fetchBgTileHi(phase: boolean) {
         if (!this.showBg && !this.showSprites) {
             return;
         }
         const y = (this.v >> 12) & 0x07;
         if (this.getByte(this.addrTileBase + (this.nt << 4) + 8 + y, phase)) {
             this.bgTileHi = (this.d & 0xff) | (this.bgTileHi & 0xffff00);
         }
     }

     private stepOam() {

         // http://wiki.nesdev.com/w/index.php/PPU_sprite_evaluation

         if (this.sy === 261 && this.sx === 1) {
             this.flgSpriteOverflow = false;
         } else if (this.sy === 261 || (this.sy >= 0 && this.sy <= 239)) {
             if (!this.showSprites && !this.showBg) {
                 return;
             }

             // secondary oam clear and sprite evaluation do not occor on the pre-render line, sprite tile fetches still do

             if (this.sy !== 261 && this.sx >= 1 && this.sx <= 64) {
                 // Cycles 1- 64: Secondary OAM (32 - byte buffer for current sprites on scanline) is
                 // initialized to $FF - attempting to read $2004 will return $FF.Internally, the clear operation
                 // is implemented by reading from the OAM and writing into the secondary OAM as usual, only a signal
                 // is active that makes the read always return $FF.
                 this.secondaryOam[(this.sx - 1)] = 0xff;
                 this.secondaryOamISprite[(this.sx - 1) >> 2] = -1;
                 if (this.sx === 64) {
                     this.addrOam = 0;
                     this.addrSecondaryOam = 0;
                     this.oamState = OamState.FillSecondaryOam;
                     this.copyToSecondaryOam = 0;
                 }
             } else if (this.sy !== 261 && this.sx >= 65 && this.sx <= 256) {
                 // Cycles 65- 256: Sprite evaluation
                 //  On odd cycles, data is read from (primary) OAM
                 //  On even cycles, data is written to secondary OAM (unless writes are inhibited, in which case it will
                 // read the value in secondary OAM instead)
                 //  1. Starting at n = 0, read a sprite's Y-coordinate (OAM[n][0], copying it to the next open slot in secondary OAM
                 //        (unless 8 sprites have been found, in which case the write is ignored).
                 //     1a.If Y- coordinate is in range, copy remaining bytes of sprite data (OAM[n][1] thru OAM[n][3]) into secondary OAM.

                 if (this.sx & 1) {
                     this.oamB = this.oam[this.addrOam];
                 } else {
                     switch (this.oamState) {
                         case OamState.FillSecondaryOam:
                             this.secondaryOam[this.addrSecondaryOam] = this.oamB;

                             if (this.copyToSecondaryOam) {
                                 this.copyToSecondaryOam--;
                                 this.addrSecondaryOam++;
                                 this.addrOam++;
                             } else if (this.sy >= this.oamB && this.sy < this.oamB + this.spriteHeight) {

                                 this.secondaryOamISprite[this.addrSecondaryOam >> 2] = this.addrOam >> 2;
                                 this.addrSecondaryOam++;
                                 this.copyToSecondaryOam = 3;
                                 this.addrOam++;
                             } else {
                                 this.addrOam += 4;
                             }

                             if (this.addrSecondaryOam === 32) {
                                 // found 8 sprites
                                 this.copyToSecondaryOam = 0;
                                 this.oamState = OamState.CheckOverflow;
                             }
                             break;

                         case OamState.CheckOverflow:
                             if (this.copyToSecondaryOam) {
                                 this.copyToSecondaryOam--;
                                 this.addrOam++;
                             } else if (this.sy >= this.oamB && this.sy < this.oamB + this.spriteHeight) {
                                 this.flgSpriteOverflow = true;
                                 this.copyToSecondaryOam = 3;
                                 this.addrOam++;
                             } else {
                                 this.addrOam += 4;
                                 this.addrOam = (this.addrOam & 0xfffc) | (((this.addrOam & 3) + 1) & 3);
                             }
                             break;

                         case OamState.Done:
                             break;
                     }
                 }

                 if (this.addrOam >> 2 === 64) {
                     this.oamState = OamState.Done;
                     this.addrOam &= 0x3;
                 }
                 this.addrOam &= 255;
             } else if (this.sx >= 257 && this.sx <= 320) {
                 const isprite = (this.sx - 257) >> 3;
                 const addrOamBase = isprite << 2;
                 const spriteRenderingInfo = this.rgspriteRenderingInfo[isprite];
                 this.addrOam = 0;
                 const b0 = this.secondaryOam[addrOamBase];

                 switch (this.sx & 7) {
                     case 1: {
                         const b2 = this.secondaryOam[addrOamBase + 2];
                         const b3 = this.secondaryOam[addrOamBase + 3];
                         spriteRenderingInfo.ipaletteBase = (b2 & 3) << 2;
                         spriteRenderingInfo.behindBg = !!(b2 & (1 << 5));
                         spriteRenderingInfo.flipHoriz = !!(b2 & (1 << 6));
                         spriteRenderingInfo.flipVert = !!(b2 & (1 << 7));
                         spriteRenderingInfo.xCounter = this.secondaryOamISprite[isprite] === -1 ? -1000 : b3;

                         spriteRenderingInfo.flgZeroSprite = !this.secondaryOamISprite[isprite];
                         break;
                     }
                     case 4:
                     case 5: {
                         const b1 = this.secondaryOam[addrOamBase + 1];
                         this.rgspriteRenderingInfo[isprite].tileLo = this.fetchSpriteTileLo(b0 >= 0xef ? this.sy : b0,
                             b1, spriteRenderingInfo.flipVert, (this.sx & 7) === 5);
                         break;
                     }
                     case 6:
                     case 7: {
                         const b1 = this.secondaryOam[addrOamBase + 1];
                         spriteRenderingInfo.tileHi = this.fetchSpriteTileHi(b0 >= 0xef ? this.sy : b0, b1,
                             spriteRenderingInfo.flipVert, (this.sx & 7) === 7);
                         break;
                     }
                 }
             }

         }
     }

     private stepDraw() {
         if (this.sy === 261 && this.sx === 0) {
             this.flgSpriteZeroHit = false;
         }

         if (this.sx >= 1 && this.sy >= 0 && this.sx <= 256 && this.sy < 240) {
             let icolorBg: number;
             let bgTransparent = true;

             if (this.showBg && (this.showBgInLeftmost8Pixels || this.sx > 8)) {
                 const tileCol = 17 - this.x;

                 const ipalette0 = (this.bgTileLo >> (tileCol)) & 1;
                 const ipalette1 = (this.bgTileHi >> (tileCol - 2)) & 1;
                 const ipalette2 = (this.p2 >> (tileCol + 2)) & 1;
                 const ipalette3 = (this.p3 >> (tileCol + 2)) & 1;

                 let ipalette = (ipalette3 << 3) + (ipalette2 << 2) + (ipalette1 << 1) + ipalette0;
                 bgTransparent = !ipalette0 && !ipalette1;

                 /* Addresses $3F04/$3F08/$3F0C can contain unique data, though these values are not used by the PPU when normally rendering
                  (since the pattern values that would otherwise select those cells select the backdrop color instead).
                  They can still be shown using the background palette hack, explained below.*/

                 // 0 in each palette means the default background color -> ipalette = 0
                 if ((ipalette & 3) === 0) {
                     ipalette = 0;
                 }

                 icolorBg = this.paletteGetter(0x3f00 | ipalette);

             } else {
                 if ((this.v & 0x3f00) === 0x3f00) {
                     icolorBg = this.paletteGetter(this.v & 0x3fff);
                 } else {
                     icolorBg = this.paletteGetter(0x3f00);
                 }
             }

             let icolorSprite = -1;
             let spriteTransparent = true;
             let spriteBehindBg = true;
             let flgZeroSprite = false;
             if (this.showSprites) {
                 for (let isprite = 0; isprite < 8; isprite++) {
                     const spriteRenderingInfo = this.rgspriteRenderingInfo[isprite];

                     if ((this.showSpritesInLeftmost8Pixels || this.sx > 8) && spriteTransparent &&
                         spriteRenderingInfo.xCounter <= 0 && spriteRenderingInfo.xCounter >= -7) {
                         const tileCol = spriteRenderingInfo.flipHoriz ? -spriteRenderingInfo.xCounter : 7 + spriteRenderingInfo.xCounter;
                         const ipalette0 = (spriteRenderingInfo.tileLo >> tileCol) & 1;
                         const ipalette1 = (spriteRenderingInfo.tileHi >> tileCol) & 1;
                         if (ipalette0 || ipalette1) {
                             spriteTransparent = false;
                             spriteBehindBg = spriteRenderingInfo.behindBg;
                             flgZeroSprite = spriteRenderingInfo.flgZeroSprite;
                             let ipalette = spriteRenderingInfo.ipaletteBase + ipalette0 + (ipalette1 << 1);
                             if ((ipalette & 3) === 0) {
                                 ipalette = 0;
                             }
                             icolorSprite = this.paletteGetter(0x3f10 | ipalette);
                         }
                     }

                     spriteRenderingInfo.xCounter--;
                 }
             }

             if (flgZeroSprite && !bgTransparent && this.showBg && this.showSprites
                 && this.sx < 256 && this.sy > 0
                 && (this.sx > 8 || (this.showSpritesInLeftmost8Pixels && this.showBgInLeftmost8Pixels))) {
                 this.flgSpriteZeroHit = true;
             }

             if (this.sx <= 8 || this.sy <= 8 || this.sx => 256 - 8 || this.sy => 240 - 8) {
                this.data[this.dataAddr] = this.colors[0x0f];
             } else if (!spriteTransparent && (bgTransparent || !spriteBehindBg)) {
                 this.data[this.dataAddr] = this.colors[icolorSprite];
             } else {
                 this.data[this.dataAddr] = this.colors[icolorBg];
             }
             this.dataAddr++;
         }
     }

     private stepBg() {
         // http://wiki.nesdev.com/w/images/d/d1/Ntsc_timing.png
         if (this.sy >= 0 && this.sy <= 239 || this.sy === 261) {

             if ((this.sx >= 1 && this.sx <= 256) || (this.sx >= 321 && this.sx <= 336)) {
                 this.bgTileLo = (this.bgTileLo << 1) & 0xffffff;
                 this.bgTileHi = (this.bgTileHi << 1) & 0xffffff;
                 this.p2 = (this.p2 << 1) & 0xffffff;
                 this.p3 = (this.p3 << 1) & 0xffffff;

                 if (this.sy === 261 && this.sx === 1) {
                     this.flgVblank = false;
                 }

                 switch (this.sx & 0x07) {
                     case 1:
                         this.fetchNt(false);
                         break;
                     case 2:
                         this.fetchNt(true);
                         break;
                     case 3:
                         this.fetchAt(false);
                         break;
                     case 4:
                         this.fetchAt(true);
                         this.fetchBgTileLo(false);
                         break;
                     case 6:
                         this.fetchBgTileLo(true);
                         this.fetchBgTileHi(false);
                         break;
                     case 0:
                         this.fetchBgTileHi(true);
                         if (this.sx === 256) {
                             this.incVertV();
                         } else {
                             this.incHoriV();
                         }
                         break;
                 }

             } else if (this.sx === 257) {
                 this.resetHoriV();
             } else if (this.sy === 261 && this.sx >= 280 && this.sx <= 304) {
                 this.resetVertV();
             } else if (this.sx >= 337 && this.sx <= 340) {
                 this.fetchUnusedNt(!(this.sx & 2));
             }
         } else if (this.sy === 240) {
             if (this.sx === 0) {
                 this.renderer.render();
                 this.iFrame++;
                 this.dataAddr = 0;
             }
         } else if (this.sy === 241) {
             if (this.sx === 1 && !this.flgVblankSuppress) {
                 this.flgVblank = true;
                 if (this.nmiOutput) {
                     this.cpu.nmiLine = 0;
                 }
             } else if (this.sx === 260) {
                 this.cpu.nmiLine = 1;
             }
         }
     }

     private stepS() {
         if (this.sx === 338 && this.sy === 261) {
             this.shortFrame = (this.iFrame & 1) && (this.showBg || this.showSprites);
         }

         if (this.shortFrame && this.sx === 339 && this.sy === 261) {
             this.sx = 0;
             this.sy = 0;
         } else {
             this.sx++;
             if (this.sx === 341) {
                 this.sx = 0;
                 this.sy++;
             }
             if (this.sy === 262) {
                 this.sy = 0;
             }
         }
     }

     private setByte(addr: number, value: number) {
         this.vmemory.setByte(addr, value);
     }

     private getByte(addr: number, phase: boolean) {
         if (!phase) {
             this.triggerMemoryAccess(addr);
             return false;
         } else {
             this.d = this.vmemory.getByte(addr);
             return true;
         }

     }

     private triggerMemoryAccess(addr: number) {
         this.vmemory.lastAddr = addr;
     }
 }
