import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import fs from 'fs';

const EPSILON = 1e-5;
class Vertex {
  constructor(pos, normal) { this.pos=pos; this.normal=normal; }
  clone(){return new Vertex(this.pos.clone(),this.normal.clone());}
  flip(){this.normal.multiplyScalar(-1);}
  interpolate(other,t){return new Vertex(this.pos.clone().lerp(other.pos,t), this.normal.clone().lerp(other.normal,t).normalize());}
}
class Plane {
  constructor(normal,w){this.normal=normal;this.w=w;}
  clone(){return new Plane(this.normal.clone(),this.w);}
  flip(){this.normal.multiplyScalar(-1);this.w=-this.w;}
  static fromPoints(a,b,c){ const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize(); return new Plane(n,n.dot(a)); }
  splitPolygon(polygon, coplanarFront, coplanarBack, front, back){
    const COPLANAR=0, FRONT=1, BACK=2, SPANNING=3; let polygonType=0; const types=[];
    for(const v of polygon.vertices){ const t=this.normal.dot(v.pos)-this.w; const type=t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR; polygonType|=type; types.push(type); }
    switch(polygonType){
      case COPLANAR: (this.normal.dot(polygon.plane.normal)>0 ? coplanarFront : coplanarBack).push(polygon); break;
      case FRONT: front.push(polygon); break;
      case BACK: back.push(polygon); break;
      case SPANNING: {
        const f=[], b=[]; const vs=polygon.vertices;
        for(let i=0;i<vs.length;i++){
          const j=(i+1)%vs.length; const ti=types[i], tj=types[j]; const vi=vs[i], vj=vs[j];
          if(ti!==BACK) f.push(vi); if(ti!==FRONT) b.push(ti!==BACK ? vi.clone() : vi);
          if((ti|tj)===SPANNING){ const t=(this.w-this.normal.dot(vi.pos))/this.normal.dot(vj.pos.clone().sub(vi.pos)); const v=vi.interpolate(vj,t); f.push(v); b.push(v.clone()); }
        }
        if(f.length>=3) front.push(new Polygon(f)); if(b.length>=3) back.push(new Polygon(b));
      } break;
    }
  }
}
class Polygon {
  constructor(vertices){this.vertices=vertices;this.plane=Plane.fromPoints(vertices[0].pos,vertices[1].pos,vertices[2].pos);}
  clone(){return new Polygon(this.vertices.map(v=>v.clone()));}
  flip(){this.vertices.reverse().forEach(v=>v.flip());this.plane.flip();}
}
class Node {
  constructor(polygons=[]){this.plane=null;this.front=null;this.back=null;this.polygons=[]; if(polygons.length) this.build(polygons);}
  clone(){const n=new Node();n.plane=this.plane&&this.plane.clone();n.front=this.front&&this.front.clone();n.back=this.back&&this.back.clone();n.polygons=this.polygons.map(p=>p.clone());return n;}
  invert(){for(const p of this.polygons)p.flip();this.plane?.flip();this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
  clipPolygons(polygons){if(!this.plane)return polygons.slice(); const front=[],back=[]; for(const p of polygons)this.plane.splitPolygon(p,front,back,front,back); let f=this.front?this.front.clipPolygons(front):front; let b=this.back?this.back.clipPolygons(back):[]; return f.concat(b);}
  clipTo(bsp){this.polygons=bsp.clipPolygons(this.polygons);this.front?.clipTo(bsp);this.back?.clipTo(bsp);}
  allPolygons(){let p=this.polygons.slice();if(this.front)p=p.concat(this.front.allPolygons());if(this.back)p=p.concat(this.back.allPolygons());return p;}
  build(polygons){if(!polygons.length)return;if(!this.plane)this.plane=polygons[0].plane.clone();const front=[],back=[];for(const p of polygons)this.plane.splitPolygon(p,this.polygons,this.polygons,front,back);if(front.length){if(!this.front)this.front=new Node();this.front.build(front);}if(back.length){if(!this.back)this.back=new Node();this.back.build(back);}}
}
class CSG {
  constructor(polygons=[]){this.polygons=polygons;}
  clone(){return new CSG(this.polygons.map(p=>p.clone()));}
  union(csg){const a=new Node(this.clone().polygons);const b=new Node(csg.clone().polygons);a.clipTo(b);b.clipTo(a);b.invert();b.clipTo(a);b.invert();a.build(b.allPolygons());return new CSG(a.allPolygons());}
}
function geomToCSG(geom,matrix){ const g=geom.index?geom.toNonIndexed():geom; const pos=g.getAttribute('position'), nor=g.getAttribute('normal'); const nm=new THREE.Matrix3().getNormalMatrix(matrix); const ps=[]; for(let i=0;i<pos.count;i+=3){const vs=[];for(let j=0;j<3;j++){const p=new THREE.Vector3().fromBufferAttribute(pos,i+j).applyMatrix4(matrix);const n=nor?new THREE.Vector3().fromBufferAttribute(nor,i+j).applyMatrix3(nm).normalize():new THREE.Vector3();vs.push(new Vertex(p,n));} ps.push(new Polygon(vs));} return new CSG(ps); }
function csgToGeom(csg){const arr=[]; for(const p of csg.polygons){ for(let i=2;i<p.vertices.length;i++){ for(const v of [p.vertices[0],p.vertices[i-1],p.vertices[i]]) arr.push(v.pos.x,v.pos.y,v.pos.z); } } const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));g.computeVertexNormals();return g;}
const buf=fs.readFileSync('/mnt/data/buildingBlock(2).stl'); const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength); const geom=new STLLoader().parse(ab); geom.computeBoundingBox(); const b=geom.boundingBox; geom.translate(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,-b.min.z); geom.computeVertexNormals();
console.time('from'); const a=geomToCSG(geom,new THREE.Matrix4().makeTranslation(0,0,0)); const bb=geomToCSG(geom,new THREE.Matrix4().makeTranslation(20,0,0)); console.timeEnd('from');
console.log(a.polygons.length,bb.polygons.length); console.time('union'); const u=a.union(bb); console.timeEnd('union'); console.log('union polygons',u.polygons.length); const out=csgToGeom(u); out.computeBoundingBox(); console.log('bounds',out.boundingBox.min.toArray(),out.boundingBox.max.toArray(),'tris',out.getAttribute('position').count/3);
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
const mesh=new THREE.Mesh(out,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);const stl=new STLExporter().parse(mesh,{binary:true});fs.writeFileSync('/mnt/data/union2.stl', Buffer.from(stl));
