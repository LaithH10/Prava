import React from 'react'
import SearchBar from '../../components/SearchBar/SearchBar'
import './Properties.css' 

const Properties = () => {
  return (
    <div className="wrapper">
      <div className="flexColCenter paddings innerWidth properties-container">
        <SearchBar/>
      </div>
    </div>
  )
}

export default Properties