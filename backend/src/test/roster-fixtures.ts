import { deflateRawSync } from 'node:zlib';

/** Rostering test fixtures (src/rostering): a OneRoster 1.2 CSV bundle with some malformed rows, and a ZIP builder. */

/** A minimal ZIP (CRC left 0: the reader does not check it). */
export function makeZip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export const BUNDLE_12 = {
  'orgs.csv': 'sourcedId,status,dateLastModified,name,type,identifier,parentSourcedId\norg-1,,,North High,school,NH,\norg-2,tobedeleted,,Old School,school,,\n',
  'academicSessions.csv':
    'sourcedId,status,dateLastModified,title,type,startDate,endDate,parentSourcedId,schoolYear\n' +
    'y26,,,2026-2027,schoolYear,2026-09-01,2027-07-15,,2027\n' +
    't1,,,Term 1,term,2026-09-01,2026-12-18,y26,2027\n' +
    'bad,,,Broken,quarterish,2026-01-01,2026-02-01,,\n',
  'users.csv':
    'sourcedId,status,dateLastModified,enabledUser,username,givenName,familyName,identifier,email,birthDate\n' +
    'u-s1,,,true,jr,Jordan,Rivera,1001,Jordan.Rivera@School.org,2012-04-30\n' +
    'u-s2,,,true,ap,Alex,Park,1002,,\n' +
    'u-t1,,,true,al,Ada,Lovelace,,ada@school.org,\n' +
    'u-p1,,,true,pp,Pat,Parent,,pat@home.org,\n' +
    'u-off,,,false,xx,Gone,Away,,gone@school.org,\n' +
    'u-bad,,,true,bb,Bad,Email,,not-an-email,\n',
  'roles.csv':
    'sourcedId,status,dateLastModified,userSourcedId,roleType,role,orgSourcedId\n' +
    'r1,,,u-s1,primary,student,org-1\nr2,,,u-s2,primary,student,org-1\nr3,,,u-t1,primary,teacher,org-1\nr4,,,u-p1,primary,parent,org-1\nr5,,,u-bad,primary,student,org-1\n',
  'classes.csv':
    'sourcedId,status,dateLastModified,title,grades,courseSourcedId,classCode,classType,location,schoolSourcedId,termSourcedIds\n' +
    'c-1,,,Mathematics 7A,7,crs-1,MATH7A,scheduled,,org-1,t1\n' +
    ',,,No Id,7,crs-1,X,scheduled,,org-1,t1\n',
  'enrollments.csv':
    'sourcedId,status,dateLastModified,classSourcedId,schoolSourcedId,userSourcedId,role,primary\n' +
    'e-1,,,c-1,org-1,u-s1,student,false\ne-2,,,c-1,org-1,u-s2,student,false\ne-3,,,c-1,org-1,u-t1,teacher,true\ne-4,,,c-1,org-1,u-t1,administrator,false\n',
};

